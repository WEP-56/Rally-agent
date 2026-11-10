import { useEffect, useRef, useState } from "react";
import { Search, X, ArrowUp, ArrowDown } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import type { TerminalState } from "../../../shared/terminal";
import { useApp } from "../store";
import { IconButton } from "./ui";

export function TerminalView({ id, taskId, visible }: { id: string; taskId?: string; visible: boolean }) {
  const { config } = useApp();
  const container = useRef<HTMLDivElement>(null); const terminal = useRef<Terminal | null>(null); const fit = useRef<FitAddon | null>(null); const search = useRef<SearchAddon | null>(null);
  const [state, setState] = useState<TerminalState>(); const [error, setError] = useState(""); const [finding, setFinding] = useState(false); const [query, setQuery] = useState("");
  const shown = useRef(visible); shown.current = visible; const ready = useRef(false);
  useEffect(() => {
    const element = container.current!; const api = window.rally.terminal; let disposed = false;
    const term = terminal.current = new Terminal({ cursorBlink: true, fontSize: 12.5, lineHeight: 1.4, fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace', scrollback: 5000, allowProposedApi: true });
    const fitter = fit.current = new FitAddon(); const finder = search.current = new SearchAddon();
    term.loadAddon(fitter); term.loadAddon(finder); term.loadAddon(new Unicode11Addon()); term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon((event, url) => { if (event.ctrlKey || event.metaKey) void api.openLink(url).catch(reason => setError(String(reason))); }));
    term.open(element);
    const applyTheme = () => { const css = getComputedStyle(element); term.options.theme = { background: css.getPropertyValue("--c-term").trim(), foreground: css.getPropertyValue("--c-fg").trim(), cursor: css.getPropertyValue("--c-accent").trim(), selectionBackground: "#80808055" }; };
    applyTheme(); const themeObserver = new MutationObserver(applyTheme); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    const resize = () => { if (shown.current && element.clientWidth > 0 && element.clientHeight > 0) fitter.fit(); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    const resized = term.onResize(size => { if (ready.current) void api.resize(id, size).catch(reason => { if (!disposed) setError(String(reason)); }); });
    const input = term.onData(data => {
      if (!ready.current) return;
      for (let index = 0; index < data.length;) {
        let end = Math.min(index + 32768, data.length);
        // A separate UTF-8 write must never end halfway through an emoji surrogate pair.
        if (end < data.length && data.charCodeAt(end - 1) >= 0xd800 && data.charCodeAt(end - 1) <= 0xdbff) end--;
        void api.write(id, data.slice(index, end)).catch(reason => { if (!disposed) setError(String(reason)); }); index = end;
      }
    });
    term.attachCustomKeyEventHandler(event => {
      const mod = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
      if (mod && ["b", "k", ",", "1", "2", "3", "n"].includes(key)) return false;
      if (mod && key === "f") { if (event.type === "keydown") { event.preventDefault(); setFinding(true); } return false; }
      if (mod && event.shiftKey && key === "c") { if (event.type === "keydown") { event.preventDefault(); void navigator.clipboard.writeText(term.getSelection()).catch(reason => setError(String(reason))); } return false; }
      if (mod && event.shiftKey && key === "v") { if (event.type === "keydown") { event.preventDefault(); void navigator.clipboard.readText().then(text => { if (!disposed) term.paste(text); }).catch(reason => setError(String(reason))); } return false; }
      return true;
    });
    const off = api.onEvent(event => {
      if (disposed) return;
      if (event.type === "data" && event.id === id) term.write(event.data, () => { if (!disposed) void api.ack(id, event.seq).catch(() => {}); });
      else if (event.type === "state" && event.state.id === id) { ready.current = event.state.status === "running"; setState(event.state); }
    });
    void api.create(id, { cols: term.cols, rows: term.rows }, taskId).then(next => { if (!disposed) { ready.current = next.status === "running"; setState(next); resize(); if (shown.current) term.focus(); } }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; ready.current = false; off(); observer.disconnect(); themeObserver.disconnect(); input.dispose(); resized.dispose(); term.dispose(); terminal.current = null; fit.current = null; search.current = null; };
  }, [id, taskId]);
  useEffect(() => { if (visible) { fit.current?.fit(); if (!finding) terminal.current?.focus(); } }, [visible, finding, config.fontSize]);
  const find = (backward = false) => { if (query) { if (backward) search.current?.findPrevious(query); else search.current?.findNext(query); } };
  return <div className="flex h-full flex-col bg-term">
    <div className="flex h-9 shrink-0 items-center gap-2 px-4 text-[11px] text-faint">
      <span>{state?.shell ?? "终端"}</span><span className="min-w-0 flex-1 truncate" title={state?.cwd}>初始目录：{state?.cwd ?? "正在启动…"}</span>
      <IconButton title="查找 (Ctrl+F)" onClick={() => setFinding(value => !value)}><Search size={13} /></IconButton>
    </div>
    {finding && <form className="flex shrink-0 items-center gap-1 px-4 pb-2" onSubmit={event => { event.preventDefault(); find(); }}>
      <input autoFocus aria-label="查找终端内容" className="min-w-0 flex-1 rounded-lg bg-sunken px-3 py-1.5 text-xs text-fg" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setFinding(false); }} placeholder="查找终端内容" />
      <IconButton title="上一个" onClick={() => find(true)}><ArrowUp size={13} /></IconButton><IconButton title="下一个" onClick={() => find()}><ArrowDown size={13} /></IconButton><IconButton title="关闭查找" onClick={() => setFinding(false)}><X size={13} /></IconButton>
    </form>}
    <div ref={container} className="min-h-0 flex-1 overflow-hidden px-4 pb-3" />
    {(error || state?.error || state?.status === "exited") && <div role="status" className="shrink-0 px-4 pb-3 text-xs text-muted">{error || state?.error || `终端已退出，退出码 ${state?.exitCode ?? "未知"}。可打开新终端继续。`}</div>}
  </div>;
}
