import { ActionButton } from "../md3/interactive";
import { useEffect, useRef, useState } from "react";
import { Download, File, RefreshCw } from "lucide-react";
import type { Resource, ResourceRef } from "../../../shared/resources";
import { useApp } from "../store";
import { Button } from "./ui";

export function fileSize(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`; }
export function AttachmentCards({ items = [] }: { items?: ResourceRef[] }) {
  const { openResource } = useApp();
  return <div className="flex flex-wrap gap-2">{items.map(item => <ActionButton key={item.id} onClick={() => openResource(item)} className="flex min-w-0 max-w-full items-center gap-3 rounded-2xl bg-sunken p-3 text-left hover:bg-hover">
    <AttachmentThumbnail resource={item} /><span className="min-w-0"><span className="block truncate text-sm">{item.name}</span><span className="block text-xs text-muted">{fileSize(item.size)} · 点击预览</span></span>
  </ActionButton>)}</div>;
}
function AttachmentThumbnail({ resource }: { resource: ResourceRef }) {
  const [url, setUrl] = useState("");
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let alive = true;
    if (!resource.mime.startsWith("image/")) return;
    const request = () => void window.rally.resources.preview(resource.id, true).then(url => { if (alive) setUrl(url); }).catch(() => {});
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); request(); }
    }, { rootMargin: "200px" });
    if (observer && element.current) observer.observe(element.current); else request();
    return () => { alive = false; observer?.disconnect(); };
  }, [resource.id]);
  return <span ref={element} className="shrink-0">{url ? <img src={url} alt="" onError={() => setUrl("")} className="h-16 w-20 rounded-lg object-cover" /> : <File size={20} className="text-accent" />}</span>;
}
export function PendingThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type) || file.size > 32 * 1024 * 1024) return;
    const url = URL.createObjectURL(file); setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return url ? <img src={url} alt="" className="mb-2 h-16 w-24 rounded-lg object-cover" onError={() => setUrl("")} /> : null;
}
export function ResourceView({ resource: ref, visible }: { resource: ResourceRef; visible: boolean }) {
  const [resource, setResource] = useState<Resource>();
  const [url, setUrl] = useState("");
  const [text, setText] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const download = useRef<string | undefined>(undefined);
  const [received, setReceived] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const controller = new AbortController();
    setError(""); setUrl(""); setText(undefined); setResource(undefined);
    void (async () => {
      const resource = await window.rally.resources.get(ref.id);
      if (!alive) return;
      setResource(resource);
      if (resource.state === "missing") throw Error("原件已缺失，无法预览或下载");
      const url = await window.rally.resources.preview(ref.id);
      if (!alive) return;
      setUrl(url);
      if (resource.mime === "text/plain" && resource.size <= 1024 * 1024) {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw Error("无法读取文件，请刷新预览");
        const value = await response.text(); if (alive) setText(value);
      }
    })().catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; controller.abort(); };
  }, [ref.id, visible, attempt]);
  useEffect(() => {
    const off = window.rally.resources.onSave(progress => { if (progress.id === download.current) setReceived(progress.received); });
    return () => { off(); if (download.current) void window.rally.resources.cancelSave(download.current).catch(() => {}); };
  }, []);
  async function save() {
    if (download.current) return;
    const id = crypto.randomUUID(); download.current = id;
    setSaving(true); setSaved(""); setReceived(0);
    try { setSaved(await window.rally.resources.save(ref.id, id) ? "已保存到所选位置" : "已取消保存"); }
    catch (e) { setSaved(String(e)); } finally { setSaving(false); download.current = undefined; }
  }
  const mediaError = () => setError("无法播放或读取此格式，或预览连接已过期。可刷新重试或下载原件。");
  return <div className="flex h-full flex-col gap-4 overflow-auto p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="break-all font-semibold">{ref.name}</h2><p className="text-xs text-muted">{fileSize(ref.size)} · {resource?.mime ?? ref.mime}</p></div><div className="flex gap-2"><Button onClick={() => setAttempt(n => n + 1)}><RefreshCw size={14} />刷新</Button><Button onClick={() => void save()} disabled={saving || resource?.state === "missing"}><Download size={14} />{saving ? "正在保存…" : "下载"}</Button></div></div>
    {saved && <p role="status" className="text-sm text-muted">{saved}</p>}
    {saving && <div role="status" className="flex items-center gap-3 text-sm text-muted"><span>已保存 {fileSize(received)} / {fileSize(ref.size)}</span><Button onClick={() => download.current && void window.rally.resources.cancelSave(download.current).catch(e => setSaved(String(e)))}>取消下载</Button></div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {url && resource && <div className="min-h-0 flex-1 rounded-2xl bg-sunken p-3">
      {resource.mime.startsWith("image/") ? <img src={url} alt={ref.name} onError={mediaError} className="mx-auto max-h-full max-w-full object-contain" /> : resource.mime.startsWith("video/") ? <video src={url} controls preload="metadata" onError={mediaError} className="max-h-full w-full" /> : resource.mime.startsWith("audio/") ? <audio src={url} controls preload="metadata" onError={mediaError} className="w-full" /> : text !== undefined ? <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre> : <p className="p-4 text-sm text-muted">此文件暂不支持内嵌预览，可下载后打开。</p>}
    </div>}
  </div>;
}
