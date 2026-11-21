import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import type { AccessStore } from "./access.ts";
import { failure, PublicError } from "./http.ts";
import { RESOURCE_ROUTE } from "./resources.ts";
import { RESOURCE_CHUNK_BYTES } from "../../shared/resources.ts";

/** Device credentials never reach media URLs; tickets grant only one resource's GET/HEAD. */
export class ResourceGateway {
  private readonly socket: string;
  private readonly access: AccessStore;
  private readonly grants = new Map<string, { id: string; device: string; expires: number }>();
  private readonly streams = new Map<string, Set<() => void>>();
  constructor(socket: string, access: AccessStore) { this.socket = socket; this.access = access; }
  ticket(device: string, id: string): string {
    if (!RESOURCE_ROUTE.test(`/v1/resources/${id}/content`) || !this.access.hasDevice(device)) throw new PublicError("资源无效");
    for (const [key, value] of this.grants) if (value.expires < Date.now()) this.grants.delete(key);
    if (this.grants.size >= 10000) throw new PublicError("预览请求过多，请稍后重试", 429);
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, { id, device, expires: Date.now() + 120000 });
    return `/v1/resources/${id}/content?ticket=${token}`;
  }
  revoke(device: string): void {
    for (const [key, value] of this.grants) if (value.device === device) this.grants.delete(key);
    for (const close of this.streams.get(device) ?? []) close();
    this.streams.delete(device);
  }
  close(): void { for (const device of [...this.streams.keys()]) this.revoke(device); this.grants.clear(); }
  handles(url: string): boolean { return /^\/v1\/(uploads|resources)\//.test(url); }
  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "", "http://gateway"); const route = RESOURCE_ROUTE.exec(url.pathname);
    if (!route) throw new PublicError("接口不存在", 404);
    const read = route[1] === "resources" && url.pathname.endsWith("/content") && ["GET", "HEAD"].includes(req.method ?? "");
    const write = route[1] === "uploads" && !url.pathname.endsWith("/content") && req.method === "PUT";
    if (!read && !write) throw new PublicError("接口不存在", 404);
    let device: string | null;
    if (read && url.searchParams.has("ticket")) {
      const grant = this.grants.get(url.searchParams.get("ticket")!);
      if (!grant || grant.id !== route[2] || grant.expires < Date.now() || !this.access.hasDevice(grant.device)) throw new PublicError("预览已过期或设备已吊销，请刷新", 401);
      device = grant.device;
    } else {
      const auth = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
      device = auth ? this.access.authenticate(auth) : null;
      if (!device) throw new PublicError("凭据无效或已吊销", 401);
      if (req.headers["x-rally-instance"] !== this.access.instance || req.headers["x-rally-protocol"] !== "1") throw new PublicError("服务器实例或协议已变更，请重新连接", 409);
    }
    if (write && (!/^\d+$/.test(url.searchParams.get("offset") ?? "") || Number(req.headers["content-length"] ?? 0) > RESOURCE_CHUNK_BYTES)) throw new PublicError("上传位置或分块大小无效", 413);
    const headers: Record<string, string> = { "X-Rally-Device": device };
    if (write) { headers["Content-Type"] = "application/octet-stream"; if (req.headers["content-length"]) headers["Content-Length"] = req.headers["content-length"]; }
    if (read && req.headers.range) headers.Range = req.headers.range;
    if (read && typeof req.headers["if-range"] === "string") headers["If-Range"] = req.headers["if-range"];
    const upstream = request({ socketPath: this.socket, path: url.pathname + (write ? `?offset=${url.searchParams.get("offset")}` : ""), method: req.method, headers, timeout: 120000 }, response => {
      if (!this.access.hasDevice(device!)) { response.destroy(); failure(res, new PublicError("设备已吊销", 401)); return; }
      const forwarded = Object.fromEntries(Object.entries(response.headers).filter(([name]) => ["content-type", "content-length", "content-range", "accept-ranges", "etag", "content-disposition", "cache-control", "content-security-policy", "x-content-type-options", "access-control-allow-origin"].includes(name)));
      res.writeHead(response.statusCode ?? 502, forwarded); response.pipe(res);
      response.on("error", () => res.destroy());
    });
    const close = () => { upstream.destroy(); res.destroy(); };
    const group = this.streams.get(device) ?? new Set(); group.add(close); this.streams.set(device, group);
    res.once("close", () => { upstream.destroy(); group.delete(close); if (!group.size) this.streams.delete(device!); });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => failure(res, new PublicError("文件传输中断，请查询进度后重试", 503)));
    if (read) { upstream.end(); return; }
    let size = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length; callback(size > RESOURCE_CHUNK_BYTES ? new PublicError("上传分块不能超过 1 MiB", 413) : null, chunk);
    } });
    limit.on("error", error => { upstream.destroy(); failure(res, error); });
    req.once("aborted", () => upstream.destroy());
    req.once("error", () => upstream.destroy());
    req.pipe(limit).pipe(upstream);
  }
}
