import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResourceStore } from "./resource-store.ts";

export function byteRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw Error("无效读取范围");
  const left = match[1] ? Number(match[1]) : undefined;
  const right = match[2] ? Number(match[2]) : undefined;
  if ((left !== undefined && !Number.isSafeInteger(left)) || (right !== undefined && !Number.isSafeInteger(right))) throw Error("无效读取范围");
  const start = left ?? Math.max(0, size - (right ?? 0));
  const end = left === undefined ? size - 1 : Math.min(right ?? size - 1, size - 1);
  if (start >= size || start > end) throw Error("无效读取范围");
  return { start, end };
}

/** The caller authenticates before invoking this function. Bytes never pass through JSON RPC. */
export async function serveResource(req: IncomingMessage, res: ServerResponse, store: ResourceStore, id: string, actor?: string): Promise<void> {
  const resource = store.get(id, actor);
  const path = store.path(id, actor);
  if ((await stat(path)).size !== resource.size) throw Error("资源文件不完整");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", resource.mime);
  res.setHeader("ETag", `"${resource.sha256}"`);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(resource.name).replace(/'/g, '%27')}`);
  let range;
  try { range = byteRange(req.headers["if-range"] && req.headers["if-range"] !== `"${resource.sha256}"` ? undefined : req.headers.range, resource.size); }
  catch { res.writeHead(416, { "Content-Range": `bytes */${resource.size}` }); res.end(); return; }
  if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${resource.size}`);
  res.setHeader("Content-Length", range ? range.end - range.start + 1 : resource.size);
  res.writeHead(range ? 206 : 200);
  if (req.method === "HEAD" || !resource.size) { res.end(); return; }
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(path, range);
    res.once("close", () => { stream.destroy(); done(); });
    stream.once("error", error => { res.destroy(); fail(error); });
    res.once("finish", done);
    stream.pipe(res);
  });
}
