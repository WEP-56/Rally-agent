import type { IncomingMessage, ServerResponse } from "node:http";
import { IpcChannel as C } from "../../shared/ipc.ts";
import { RESOURCE_CHUNK_BYTES, type UploadRequest } from "../../shared/resources.ts";
import type { ResourceStore } from "../resource-store.ts";
import { serveResource } from "../resource-http.ts";
import { PublicError, reply } from "./http.ts";

export const RESOURCE_ROUTE = /^\/v1\/(uploads|resources)\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/content)?$/;
export const RESOURCE_COMMANDS = new Set<string>([C.resourceBegin, C.resourceStatus, C.resourceComplete, C.resourceCancel, C.resourceGet, C.resourcePreview]);

/** Only metadata uses JSON RPC. Device ownership is supplied by the authenticated gateway. */
export async function resourceCommand(store: ResourceStore, device: string, channel: string, args: unknown[]): Promise<unknown> {
  if (!device || typeof device !== "string") throw new PublicError("设备身份无效", 401);
  try {
    if (channel === C.resourceBegin) return store.begin(device, args[0] as UploadRequest);
    if (typeof args[0] !== "string") throw new PublicError("资源编号无效");
    const id = args[0];
    if (channel === C.resourceStatus) return store.status(device, id);
    if (channel === C.resourceComplete) return await store.complete(device, id);
    if (channel === C.resourceCancel) return await store.cancel(device, id);
    if (channel === C.resourceGet) return store.get(id, device);
    if (channel === C.resourcePreview) {
      const resource = args[1] === true ? await store.thumbnail(id, device) : store.get(id, device);
      if (resource.state !== "ready") throw Error("资源原件已缺失");
      return resource;
    }
    throw new PublicError("云端不支持此资源操作");
  } catch (error) {
    // Store validation is safe to report. Native filesystem diagnostics stay server-side.
    if (error instanceof Error && !("code" in error)) throw new PublicError(error.message);
    throw error;
  }
}

export async function resourceBytes(req: IncomingMessage, res: ServerResponse, store: ResourceStore): Promise<void> {
  const url = new URL(req.url ?? "", "http://runtime");
  const route = RESOURCE_ROUTE.exec(url.pathname);
  const device = req.headers["x-rally-device"];
  if (!route || typeof device !== "string" || !device) throw new PublicError("资源请求无效", 400);
  if (route[1] === "resources" && url.pathname.endsWith("/content") && ["GET", "HEAD"].includes(req.method ?? "")) {
    try { await serveResource(req, res, store, route[2], device); }
    catch { throw new PublicError("资源不存在、已缺失或无权访问", 404); }
    return;
  }
  if (route[1] !== "uploads" || req.method !== "PUT" || url.pathname.endsWith("/content")) throw new PublicError("接口不存在", 404);
  if (!/^\d+$/.test(url.searchParams.get("offset") ?? "")) throw new PublicError("上传位置无效");
  const offset = Number(url.searchParams.get("offset"));
  if (!Number.isSafeInteger(offset)) throw new PublicError("上传位置无效");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > RESOURCE_CHUNK_BYTES) throw new PublicError("上传分块不能超过 1 MiB", 413);
    chunks.push(chunk);
  }
  try { reply(res, 200, await store.append(device, route[2], offset, Buffer.concat(chunks))); }
  catch (error) { throw new PublicError(error instanceof Error && !("code" in error) ? error.message : "上传失败，请查询进度后重试"); }
}
