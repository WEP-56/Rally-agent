import { RESOURCE_CHUNK_BYTES, type Resource, type UploadState } from "../../shared/resources.ts";
import { saveResource } from "../resource-download.ts";

/** Native-only client: credentials never enter renderer state or the preview URL. */
export class CloudResourceClient {
  private readonly base: string;
  private readonly headers: () => Record<string, string>;
  constructor(base: string, instance: string, token: () => string) {
    this.base = base;
    this.headers = () => ({ Authorization: `Bearer ${token()}`, "X-Rally-Instance": instance, "X-Rally-Protocol": "1" });
  }
  private id(value: string): string { if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) throw Error("无效资源编号"); return value; }
  async append(id: string, offset: number, bytes: Uint8Array, signal: AbortSignal): Promise<UploadState> {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > RESOURCE_CHUNK_BYTES || !Number.isSafeInteger(offset) || offset < 0) throw Error("上传分块无效");
    const response = await fetch(`${this.base}/v1/uploads/${this.id(id)}?offset=${offset}`, { method: "PUT", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      headers: { ...this.headers(), "Content-Type": "application/octet-stream" }, body: Buffer.from(bytes) });
    const value: unknown = await response.json();
    if (!response.ok) throw Error(value && typeof value === "object" && "error" in value ? String(value.error) : `上传失败：${response.status}`);
    signal.throwIfAborted();
    return value as UploadState;
  }
  async save(resource: Resource, destination: string, signal: AbortSignal, progress: (received: number) => void): Promise<void> {
    const response = await fetch(`${this.base}/v1/resources/${this.id(resource.id)}/content`, { headers: this.headers(), signal, redirect: "error" });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(`下载失败：${response.status}`); }
    const stream = response.body;
    async function* bytes() {
      const reader = stream.getReader();
      try { for (;;) { const item = await reader.read(); if (item.done) return; yield item.value; } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    try { await saveResource(bytes(), destination, resource, signal, progress); }
    finally { await stream.cancel().catch(() => {}); }
  }
}
