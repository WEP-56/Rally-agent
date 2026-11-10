import { useEffect, useState } from "react";
import { FolderOpen, Info } from "lucide-react";
import type { MemoryState } from "../../../shared/memory";
import { useApp } from "../store";
import { Button, Input } from "./ui";

export function MemoryForm() {
  const { setConfig } = useApp();
  const [state, setState] = useState<MemoryState>();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = (initial = false) => { void window.rally.memory.getState().then((value) => {
      if (active) { setState(value); if (initial) setPath(value.path); }
    }).catch((e: unknown) => { if (active) setError(String(e)); }); };
    const onFocus = () => refresh();
    refresh(true); window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    <label className="text-xs font-medium text-muted" htmlFor="memory-path">记忆文件路径</label>
    <div className="flex gap-2">
      <Input id="memory-path" className="font-mono text-[13px]" value={path} disabled={busy} onChange={(e) => setPath(e.target.value)} />
      <Button disabled={busy} onClick={() => void run(async () => { const value = await window.rally.memory.pickFile(); if (value) setPath(value); })}><FolderOpen size={14} />浏览…</Button>
      <Button disabled={busy || !path} onClick={() => void run(async () => { const value = await window.rally.memory.setPath(path); setState(value); setPath(value.path); setConfig({ memoryPath: value.path }); })}>保存</Button>
    </div>
    <div className="flex gap-2.5 rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-muted">
      <Info size={14} className="mt-0.5 shrink-0 text-faint" />
      <div>记忆保存在一个 Markdown 文件中，可直接编辑。只有你明确要求“记住”或“忘掉”时，主助手才会修改记忆。修改后下次模型调用生效；切换路径不会迁移原文件。</div>
    </div>
    {state && <div className="rounded-xl bg-sunken px-4 py-3 text-xs text-muted">
      <div>{state.exists ? `${state.entries} 条标记记忆 · ${state.bytes} 字节 · 约 ${state.estimatedTokens} tokens` : "尚未创建记忆文件"}</div>
      <div className="mt-1">上下文预算约 2,000 tokens（估算）。{state.overBudget ? "已超出预算，请打开文件精简；目前只读取开头部分。" : ""}</div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy || path !== state.path} onClick={() => void run(async () => { await window.rally.memory.open(); setState(await window.rally.memory.getState()); })}>用编辑器打开</Button>
        <Button size="sm" disabled={busy} onClick={() => void run(async () => setState(await window.rally.memory.getState()))}>刷新状态</Button>
      </div>
    </div>}
    {(error || state?.error) && <p role="alert" className="text-xs text-danger">{error || state?.error}</p>}
  </div>;
}
