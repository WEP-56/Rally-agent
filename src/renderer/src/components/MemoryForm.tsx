import { useEffect, useState } from "react";
import { FolderOpen, Info } from "lucide-react";
import type { MemoryFileKey, MemoryState } from "../../../shared/memory";
import { Button } from "./ui";

const LABELS: Record<MemoryFileKey, { title: string; desc: string }> = {
  USER: { title: "画像", desc: "你是谁：工作、项目、重要的人、设备环境" },
  PREFERENCES: { title: "偏好", desc: "你希望事情怎么做" },
  RECENT: { title: "近期", desc: "眼下正在发生、会过期的事" },
};

export function MemoryForm() {
  const [state, setState] = useState<MemoryState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const local = window.runtime.mode !== "cloud";
  useEffect(() => {
    let active = true;
    const refresh = () => { void window.rally.memory.getState().then((value) => { if (active) setState(value); }).catch((e: unknown) => { if (active) setError(String(e)); }); };
    refresh(); window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, []);
  async function open(file?: MemoryFileKey) {
    setBusy(true); setError("");
    try { await window.rally.memory.open(file); setState(await window.rally.memory.getState()); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    <div className="flex gap-2.5 rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-muted">
      <Info size={14} className="mt-0.5 shrink-0 text-faint" />
      <div>记忆是 Rally 自己维护的小本本，分成三个 Markdown 文件。它会在对话中随手记，开启教练后，它会每晚整理、合并和归档。你可以随时打开查看或直接修改，改动在下一次回复时生效。</div>
    </div>
    {state && <div className="rounded-xl bg-sunken px-4 py-3 text-xs text-muted">
      <div title={state.dir} className="truncate font-mono text-[13px] text-fg">{state.dir}</div>
      <div className="mt-3 flex flex-col gap-2.5">
        {state.files.map((file) => <div key={file.key} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-fg">{LABELS[file.key].title}<span className="ml-2 text-muted">{LABELS[file.key].desc}</span></div>
            <div className="mt-0.5">{file.exists ? `${file.bytes} / ${file.budget} 字节` : "尚未创建"}</div>
          </div>
          {local && <Button size="sm" disabled={busy} onClick={() => void open(file.key)}>打开</Button>}
        </div>)}
      </div>
      {local && <div className="mt-3"><Button size="sm" disabled={busy} onClick={() => void open()}><FolderOpen size={14} />打开文件夹</Button></div>}
    </div>}
    {(error || state?.error) && <p role="alert" className="text-xs text-danger">{error || state?.error}</p>}
  </div>;
}
