import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Resource } from "../shared/resources.ts";

/** A cancelled/failed download never leaves a partial file at the user's chosen destination. */
export async function saveResource(bytes: AsyncIterable<Uint8Array>, destination: string, resource: Pick<Resource, "size" | "sha256">, signal: AbortSignal, progress: (received: number) => void): Promise<void> {
  signal.throwIfAborted();
  const temp = join(dirname(destination), `.${basename(destination).slice(0, 80)}.${randomUUID()}.partial`);
  const file = await open(temp, "wx", 0o600);
  let received = 0;
  const hash = createHash("sha256");
  try {
    for await (const chunk of bytes) {
      signal.throwIfAborted();
      if (received + chunk.length > resource.size) throw Error("下载数据超过声明大小");
      let offset = 0;
      while (offset < chunk.length) {
        const written = await file.write(chunk, offset, chunk.length - offset, received + offset);
        if (!written.bytesWritten) throw Error("保存文件中断");
        offset += written.bytesWritten;
      }
      hash.update(chunk); received += chunk.length; progress(received);
    }
    signal.throwIfAborted();
    if (received !== resource.size || hash.digest("hex") !== resource.sha256) throw Error("下载文件校验不一致，请重试");
    await file.sync(); await file.close(); signal.throwIfAborted();
    await rename(temp, destination);
  } finally { await file.close(); await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

export class ResourceDownloads {
  private readonly pending = new Map<string, { controller: AbortController; done: Promise<boolean> }>();
  private closed = false;
  start(id: string, operation: (signal: AbortSignal) => Promise<boolean>): Promise<boolean> {
    if (this.closed) throw Error("客户端正在关闭");
    if (!/^[\w-]{1,80}$/.test(id) || this.pending.has(id)) throw Error("无效下载编号");
    if (this.pending.size >= 2) throw Error("请等待现有下载完成");
    const controller = new AbortController();
    const done = Promise.resolve().then(() => operation(controller.signal)).catch(error => {
      if (controller.signal.aborted) return false;
      throw error;
    }).finally(() => this.pending.delete(id));
    this.pending.set(id, { controller, done }); return done;
  }
  cancel(id: string): void { this.pending.get(id)?.controller.abort(); }
  async close(): Promise<void> {
    this.closed = true;
    for (const item of this.pending.values()) item.controller.abort();
    await Promise.allSettled([...this.pending.values()].map(item => item.done));
  }
}
