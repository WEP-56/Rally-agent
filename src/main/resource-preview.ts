import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { ResourceStore } from "./resource-store.ts";
import { serveResource } from "./resource-http.ts";

/** Local preview capability, scoped to one resource, expires after two minutes. */
export class ResourcePreviewHost {
  private readonly store: ResourceStore;
  private readonly grants = new Map<string, { id: string; expires: number }>();
  private readonly server;
  private ready?: Promise<number>;
  private closed = false;
  constructor(store: ResourceStore) {
    this.store = store;
    this.server = createServer(async (req, res) => {
      const grant = this.grants.get(req.url?.slice(1) ?? "");
      if (this.closed || !grant || grant.expires < Date.now() || !["GET", "HEAD"].includes(req.method ?? "")) { res.writeHead(403); res.end(); return; }
      try { await serveResource(req, res, this.store, grant.id, "desktop"); }
      catch { if (!res.headersSent) res.writeHead(404); res.end(); }
    });
  }
  async url(id: string): Promise<string> {
    if (this.closed) throw Error("文件预览已关闭");
    this.store.path(id, "desktop");
    this.ready ??= new Promise<number>((done, fail) => {
      this.server.once("error", fail);
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server.address();
        if (!address || typeof address === "string") { fail(Error("无法开启文件预览")); return; }
        done(address.port);
      });
    });
    const port = await this.ready;
    if (this.closed) throw Error("文件预览已关闭");
    for (const [key, grant] of this.grants) if (grant.expires < Date.now()) this.grants.delete(key);
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, { id, expires: Date.now() + 120000 });
    return `http://127.0.0.1:${port}/${token}`;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.grants.clear();
    if (!this.ready) return;
    await this.ready.catch(() => {});
    this.server.closeAllConnections();
    await new Promise<void>(done => this.server.close(() => done()));
  }
}
