import { useEffect, useRef, useState } from "react";
import { MESSAGE_MAX_RESOURCES, RESOURCE_MAX_BYTES, type ResourceRef } from "../../shared/resources";

export interface PendingAttachment { id: string; file: File; offset: number; uploadId?: string; resource?: ResourceRef; error?: string; running: boolean; cancelled: boolean }
export function useAttachments(conversationId?: string) {
  const rows = useRef<PendingAttachment[]>([]);
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const active = useRef(0);
  const refresh = () => { if (alive.current) setItems(rows.current.map(row => ({ ...row }))); };
  const remove = (id: string) => {
    const row = rows.current.find(item => item.id === id);
    if (!row) return;
    row.cancelled = true;
    rows.current = rows.current.filter(item => item !== row); refresh();
    if (row.uploadId && !row.resource) void window.rally.resources.cancel(row.uploadId).catch(() => {});
  };
  const clear = () => { for (const row of [...rows.current]) remove(row.id); };
  const pump = () => {
    if (!alive.current) return;
    for (const row of rows.current) {
      if (active.current >= 2) break;
      if (row.running || row.resource || row.error || row.cancelled) continue;
      row.running = true; active.current++; refresh();
      void (async () => {
        const api = window.rally.resources;
        try {
          let state;
          if (row.uploadId) {
            try { state = await api.status(row.uploadId); }
            catch (error) { if (!String(error).includes("UPLOAD_NOT_FOUND:")) throw error; row.uploadId = undefined; }
          }
          if (row.cancelled) return;
          state ??= await api.begin({ name: row.file.name, size: row.file.size, mime: row.file.type });
          row.uploadId = state.id;
          row.offset = state.offset;
          while (!row.cancelled && !state.resource && row.offset < row.file.size) {
            const bytes = new Uint8Array(await row.file.slice(row.offset, row.offset + state.chunkSize).arrayBuffer());
            if (row.cancelled) break;
            state = await api.append(state.id, row.offset, bytes);
            row.offset = state.offset; refresh();
          }
          if (row.cancelled) { await api.cancel(state.id); return; }
          row.resource = state.resource ?? await api.complete(state.id);
        } catch (e) { if (!row.cancelled) row.error = e instanceof Error ? e.message : String(e); }
        finally { active.current--; row.running = false; refresh(); pump(); }
      })();
    }
  };
  const add = (files: File[]) => {
    setError("");
    for (const file of files) {
      if (rows.current.length >= MESSAGE_MAX_RESOURCES) { setError("每条消息最多 10 个附件"); break; }
      if (file.size > RESOURCE_MAX_BYTES) { setError(`${file.name} 超过 1 GiB`); continue; }
      rows.current.push({ id: crypto.randomUUID(), file, offset: 0, running: false, cancelled: false });
    }
    refresh(); pump();
  };
  const retry = (id: string) => { const row = rows.current.find(item => item.id === id); if (row) { row.error = undefined; pump(); } };
  useEffect(() => { clear(); setError(""); }, [conversationId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clear(); }; }, []);
  return { items, error, add, remove, clear, retry, ready: items.every(item => !!item.resource) };
}
