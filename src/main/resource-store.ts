import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { copyFile, lstat, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resizeImage } from "@rally/coding-agent";
import { RESOURCE_CHUNK_BYTES, RESOURCE_MAX_BYTES, type Resource, type UploadRequest, type UploadState } from "../shared/resources.ts";

const DAY = 24 * 60 * 60 * 1000;
const ID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
interface Upload extends UploadRequest { id: string; owner: string; offset: number; updated: number; source: Resource["source"]; resourceId?: string }

/** Single runtime writer, under Supervisor's state lock. Metadata commits follow durable bytes. */
export class ResourceStore {
  private readonly db: DatabaseSync;
  private readonly directory: string;
  private readonly pending = new Map<string, Promise<unknown>>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.directory = realpathSync(directory);
    mkdirSync(join(this.directory, "incoming"), { recursive: true });
    mkdirSync(join(this.directory, "blobs"), { recursive: true });
    this.db = new DatabaseSync(join(this.directory, "resources.sqlite"));
    try { this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resource_refs(owner TEXT NOT NULL, resource TEXT NOT NULL, PRIMARY KEY(owner,resource));`); }
    catch (error) { this.db.close(); throw error; }
  }
  private assertOpen() { if (this.closed) throw Error("资源库已关闭"); }
  private temp(id: string) {
    if (!ID.test(id)) throw Error("无效上传编号");
    return join(this.directory, "incoming", id);
  }
  private blob(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("资源摘要无效");
    return join(this.directory, "blobs", hash);
  }
  private upload(id: string, owner: string): Upload {
    this.assertOpen(); this.temp(id);
    const row = this.db.prepare("SELECT data FROM uploads WHERE id=? AND owner=?").get(id, owner);
    if (!row) throw Error("UPLOAD_NOT_FOUND: 上传不存在、已取消或不属于此设备");
    return JSON.parse(String(row.data)) as Upload;
  }
  private saveUpload(value: Upload) {
    this.db.prepare("INSERT OR REPLACE INTO uploads VALUES(?,?,?)").run(value.id, value.owner, JSON.stringify(value));
  }
  private view(upload: Upload): UploadState {
    return { id: upload.id, offset: upload.offset, size: upload.size, chunkSize: RESOURCE_CHUNK_BYTES,
      ...(upload.resourceId ? { resource: this.get(upload.resourceId, upload.owner) } : {}) };
  }
  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const prior = this.pending.get(id);
    const next = Promise.resolve(prior).catch(() => {}).then(operation);
    this.pending.set(id, next);
    try { return await next; } finally { if (this.pending.get(id) === next) this.pending.delete(id); }
  }
  begin(owner: string, request: UploadRequest, source: Resource["source"] = "upload"): UploadState {
    this.assertOpen();
    if (!owner || owner.length > 200) throw Error("无效上传所有者");
    if (!request || typeof request.name !== "string" || !request.name.trim() || request.name.length > 255) throw Error("文件名不能为空且不能超过 255 字符");
    if (!Number.isSafeInteger(request.size) || request.size < 0 || request.size > RESOURCE_MAX_BYTES) throw Error("文件大小必须在 0 到 1 GiB 之间");
    const active = this.db.prepare("SELECT data FROM uploads WHERE owner=?").all(owner).map(row => JSON.parse(String(row.data)) as Upload).filter(row => !row.resourceId);
    if (active.length >= 10 || active.reduce((sum, row) => sum + row.size, 0) + request.size > 2 * RESOURCE_MAX_BYTES) throw Error("待上传文件过多，请完成或取消现有上传");
    // Names are labels only: never used as managed storage paths.
    const name = request.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").trim();
    const upload: Upload = { id: randomUUID(), name, size: request.size, owner, offset: 0, updated: Date.now(), source };
    this.saveUpload(upload);
    return this.view(upload);
  }
  status(owner: string, id: string): UploadState { return this.view(this.upload(id, owner)); }
  async append(owner: string, id: string, offset: number, bytes: Uint8Array): Promise<UploadState> {
    // Copy before queueing: callers cannot mutate the bytes while this operation waits.
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > RESOURCE_CHUNK_BYTES || bytes.byteLength === 0) throw Error("上传分块必须为 1 字节到 1 MiB");
    const buffer = Buffer.from(bytes);
    return this.serial(id, async () => {
      const upload = this.upload(id, owner);
      if (upload.resourceId) throw Error("上传已完成");
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + buffer.length > upload.size) throw Error("上传范围无效");
      const file = await open(this.temp(id), existsSync(this.temp(id)) ? "r+" : "wx+");
      try {
        const info = await file.stat();
        if (info.size < upload.offset) throw Error("临时文件不完整，请取消并重新上传");
        // Recover a crash after writing bytes but before committing the offset.
        if (info.size > upload.offset) await file.truncate(upload.offset);
        if (offset < upload.offset && offset + buffer.length <= upload.offset) {
          const old = Buffer.alloc(buffer.length);
          const result = await file.read(old, 0, old.length, offset);
          if (result.bytesRead !== old.length || !old.equals(buffer)) throw Error("重复分块内容不一致");
          return this.view(upload);
        }
        if (offset !== upload.offset) throw Error(`上传位置不一致，服务器已接收 ${upload.offset} 字节`);
        let written = 0;
        while (written < buffer.length) {
          const result = await file.write(buffer, written, buffer.length - written, offset + written);
          if (!result.bytesWritten) throw Error("文件写入中断");
          written += result.bytesWritten;
        }
        await file.sync();
        upload.offset += buffer.length; upload.updated = Date.now();
        this.saveUpload(upload);
        return this.view(upload);
      } finally { await file.close(); }
    });
  }
  async complete(owner: string, id: string, expectedHash?: string): Promise<Resource> {
    return this.serial(id, async () => {
      const upload = this.upload(id, owner);
      if (upload.resourceId) {
        const resource = this.get(upload.resourceId, owner);
        if (expectedHash && expectedHash !== resource.sha256) throw Error("文件校验不一致");
        return resource;
      }
      if (upload.offset !== upload.size) throw Error("文件尚未上传完成");
      if (upload.size === 0 && !existsSync(this.temp(id))) { const empty = await open(this.temp(id), "wx"); await empty.close(); }
      if ((await stat(this.temp(id))).size !== upload.size) throw Error("临时文件长度不一致，请查询进度后重试");
      const hash = createHash("sha256");
      let first = Buffer.alloc(0);
      for await (const chunk of createReadStream(this.temp(id))) { hash.update(chunk); if (!first.length) first = Buffer.from(chunk.subarray(0, 512)); }
      const sha256 = hash.digest("hex");
      if (expectedHash && expectedHash !== sha256) throw Error("文件校验不一致");
      const resource: Resource = { id: randomUUID(), name: upload.name, size: upload.size, mime: detectMime(first, upload.name), sha256, createdAt: Date.now(), source: upload.source, state: "ready" };
      await this.serial(`blob:${sha256}`, async () => {
      let valid = false;
      if (existsSync(this.blob(sha256))) {
        const existing = createHash("sha256");
        for await (const chunk of createReadStream(this.blob(sha256))) existing.update(chunk);
        valid = existing.digest("hex") === sha256;
      }
      if (!valid) {
        // Publish only a complete, flushed file. A prior crash cannot bless a partial blob.
        const staging = this.blob(sha256) + "." + id + ".tmp";
        await copyFile(this.temp(id), staging);
        const target = await open(staging, "r+");
        try { await target.sync(); } finally { await target.close(); }
        await rename(staging, this.blob(sha256));
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare("INSERT INTO resources VALUES(?,?,?)").run(resource.id, owner, JSON.stringify(resource));
        this.saveUpload({ ...upload, resourceId: resource.id, updated: Date.now() });
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      });
      await unlink(this.temp(id)).catch(() => {});
      return resource;
    });
  }
  async cancel(owner: string, id: string): Promise<void> {
    return this.serial(id, async () => {
      const upload = this.upload(id, owner);
      if (upload.resourceId) return; // A committed resource may already belong to a message.
      await unlink(this.temp(id)).catch(error => { if (error.code !== "ENOENT") throw error; });
      this.db.prepare("DELETE FROM uploads WHERE id=? AND owner=?").run(id, owner);
    });
  }
  get(id: string, actor?: string): Resource {
    this.assertOpen();
    if (!ID.test(id)) throw Error("无效资源编号");
    const row = this.db.prepare("SELECT owner,data FROM resources WHERE id=?").get(id);
    if (!row) throw Error("资源不存在或无权访问");
    const resource = JSON.parse(String(row.data)) as Resource;
    if (resource.derivedFrom) this.get(resource.derivedFrom, actor);
    else if (actor !== undefined && row.owner !== actor && !this.db.prepare("SELECT 1 FROM resource_refs WHERE resource=? LIMIT 1").get(id)) throw Error("资源不存在或无权访问");
    return { ...resource, state: existsSync(this.blob(resource.sha256)) ? "ready" : "missing" };
  }
  path(id: string, actor?: string): string {
    const resource = this.get(id, actor);
    if (resource.state !== "ready") throw Error("资源文件已缺失");
    return this.blob(resource.sha256);
  }
  /** References are committed as a group; shared resources survive releasing one task. */
  retain(owner: string, ids: readonly string[], actor?: string): void {
    this.assertOpen();
    if (!owner || owner.length > 300) throw Error("无效资源引用");
    for (const id of ids) this.get(id, actor); // Missing bytes still need a durable reference for recovery.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of new Set(ids)) this.db.prepare("INSERT OR IGNORE INTO resource_refs VALUES(?,?)").run(owner, id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  release(owner: string): void { this.assertOpen(); this.db.prepare("DELETE FROM resource_refs WHERE owner=?").run(owner); }
  /** Reconcile host-owned history references before allowing collection after a restart. */
  restoreReferences(owners: ReadonlyMap<string, ReadonlySet<string>>, prune: boolean): number {
    this.assertOpen();
    const known = new Set(this.db.prepare("SELECT id FROM resources").all().map(row => String(row.id)));
    const missing = new Set<string>();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (prune) this.db.exec("DELETE FROM resource_refs WHERE owner GLOB 'message:#*' OR owner GLOB 'task:T-*'");
      const insert = this.db.prepare("INSERT OR IGNORE INTO resource_refs VALUES(?,?)");
      for (const [owner, ids] of owners) for (const id of ids) {
        if (known.has(id)) insert.run(owner, id); else missing.add(id);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return missing.size;
  }
  thumbnail(id: string, actor?: string): Promise<Resource> {
    this.get(id, actor);
    return this.serial(`thumbnail:${id}`, async () => {
      const original = this.get(id, actor);
      if (!original.mime.startsWith("image/") || original.size > 32 * 1024 * 1024) throw Error("该文件不支持缩略图");
      const prior = this.db.prepare("SELECT id FROM resources WHERE json_extract(data,'$.derivedFrom')=? AND json_extract(data,'$.variant')='thumbnail'").all(id);
      for (const row of prior) { const candidate = this.get(String(row.id)); if (candidate.state === "ready") return candidate; }
      const file = await open(this.path(id), "r");
      const bytes = await file.readFile().finally(() => file.close());
      const result = await resizeImage(bytes, original.mime, { maxWidth: 256, maxHeight: 256, maxBytes: 128 * 1024 });
      if (!result) throw Error("无法生成缩略图，可打开原件预览");
      const resource = await this.importBytes("derived", `${original.name.slice(0, 230)}.thumbnail`, Buffer.from(result.data, "base64"));
      Object.assign(resource, { derivedFrom: id, variant: "thumbnail", width: result.width, height: result.height });
      this.db.prepare("UPDATE resources SET data=? WHERE id=?").run(JSON.stringify(resource), resource.id);
      this.release(`derivative:${id}`);
      this.retain(`derivative:${id}`, [resource.id]);
      return resource;
    });
  }
  importBytes(owner: string, name: string, bytes: Uint8Array, source: Resource["source"] = "tool", signal?: AbortSignal): Promise<Resource> {
    const copy = Buffer.from(bytes);
    return this.serial(`import:${randomUUID()}`, async () => {
      signal?.throwIfAborted();
      let upload = this.begin(owner, { name, size: copy.byteLength }, source);
      try {
        while (upload.offset < copy.length) {
          signal?.throwIfAborted();
          upload = await this.append(owner, upload.id, upload.offset, copy.subarray(upload.offset, upload.offset + RESOURCE_CHUNK_BYTES));
        }
        signal?.throwIfAborted();
        return await this.complete(owner, upload.id);
      } catch (error) { await this.cancel(owner, upload.id); throw error; }
    });
  }
  importFile(owner: string, path: string, roots: readonly string[], source: Resource["source"] = "directory", signal?: AbortSignal): Promise<Resource> {
    return this.serial(`import:${randomUUID()}`, () => this.importSnapshot(owner, path, roots, source, signal));
  }
  private async importSnapshot(owner: string, path: string, roots: readonly string[], source: Resource["source"], signal?: AbortSignal): Promise<Resource> {
    signal?.throwIfAborted();
    const full = resolve(path);
    if (!(await lstat(full)).isFile()) throw Error("只能导入普通文件");
    const canonical = await realpath(full);
    const allowed = await Promise.all(roots.map(root => realpath(root)));
    if (!allowed.some(root => { const part = relative(root, canonical); return part === "" || (part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part)); })) throw Error("文件不在允许的目录内");
    const handle = await open(canonical, "r");
    let upload: UploadState | undefined;
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw Error("只能导入普通文件");
      upload = this.begin(owner, { name: basename(full), size: before.size }, source);
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: RESOURCE_CHUNK_BYTES, signal })) {
        signal?.throwIfAborted();
        upload = await this.append(owner, upload.id, upload.offset, chunk);
      }
      const after = await handle.stat();
      const current = await stat(canonical);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== current.ino || before.dev !== current.dev) throw Error("文件在读取时发生变化，请重试");
      signal?.throwIfAborted();
      return await this.complete(owner, upload.id);
    } catch (error) { if (upload) await this.cancel(owner, upload.id); throw error; }
    finally { await handle.close(); }
  }
  /** Host invokes maintenance only after history recovery; never traverses user project files. */
  async sweep(now = Date.now()): Promise<void> {
    this.assertOpen();
    if (this.pending.size) return;
    for (const row of this.db.prepare("SELECT data FROM uploads").all()) {
      const upload = JSON.parse(String(row.data)) as Upload;
      if (now - upload.updated < DAY || this.pending.has(upload.id)) continue;
      await this.serial(upload.id, async () => {
        const current = this.upload(upload.id, upload.owner);
        if (now - current.updated < DAY) return;
        await unlink(this.temp(upload.id)).catch(error => { if (error.code !== "ENOENT") throw error; });
        this.db.prepare("DELETE FROM uploads WHERE id=?").run(upload.id);
      });
    }
    if (this.pending.size) return;
    // No await between reachability checks and deletion: a concurrent import cannot publish the same blob here.
    for (const row of this.db.prepare("SELECT data FROM resources WHERE id NOT IN (SELECT resource FROM resource_refs)").all()) {
      const resource = JSON.parse(String(row.data)) as Resource;
      if (now - resource.createdAt < DAY) continue;
      this.db.prepare("DELETE FROM resources WHERE id=?").run(resource.id);
      this.release(`derivative:${resource.id}`);
      const stillUsed = this.db.prepare("SELECT data FROM resources").all().some(other => (JSON.parse(String(other.data)) as Resource).sha256 === resource.sha256);
      if (!stillUsed) {
        try { unlinkSync(this.blob(resource.sha256)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
    // Reclaim crash leftovers only in the two managed directories, with exact generated names.
    const uploads = new Set(this.db.prepare("SELECT id FROM uploads").all().map(row => String(row.id)));
    const hashes = new Set(this.db.prepare("SELECT data FROM resources").all().map(row => (JSON.parse(String(row.data)) as Resource).sha256));
    for (const kind of ["incoming", "blobs"] as const) {
      const directory = join(this.directory, kind);
      if (realpathSync(directory) !== directory) throw Error("资源目录发生变化，已停止清理");
      for (const name of readdirSync(directory)) {
        const orphan = kind === "incoming" ? ID.test(name) && !uploads.has(name)
          : (/^[a-f0-9]{64}$/.test(name) && !hashes.has(name)) || /^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(name);
        if (!orphan) continue;
        const path = join(directory, name); const info = lstatSync(path);
        if (info.isFile() && now - info.mtimeMs >= DAY) unlinkSync(path);
      }
    }
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      // The host stops accepting new calls before closing its store.
      while (this.pending.size) await Promise.allSettled([...this.pending.values()]);
      this.closed = true; this.db.close();
    })();
  }
}

function detectMime(bytes: Buffer, name: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 0, 2) === "BM") return "image/bmp";
  if (bytes.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (bytes.toString("ascii", 0, 4) === "fLaC") return "audio/flac";
  if (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return "audio/mpeg";
  if (bytes.toString("ascii", 0, 4) === "OggS") return extname(name).toLowerCase() === ".ogv" ? "video/ogg" : "audio/ogg";
  if (bytes.toString("ascii", 4, 8) === "ftyp") return extname(name).toLowerCase() === ".m4a" ? "audio/mp4" : "video/mp4";
  if (bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) return "video/webm";
  if (/\.(txt|md|csv|tsv|json|log|js|ts|tsx|jsx|py|css|yaml|yml|xml|sh|ps1)$/i.test(name) && !bytes.includes(0)) return "text/plain";
  return "application/octet-stream";
}
