import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ExternalLink, Server, Home, X } from "lucide-react";
import { BROWSER_START, browserAddress } from "../../../shared/browser";
import { useBrowser } from "../browser";
import { cn } from "../utils/cn";
import { IconButton } from "./ui";
import { LocalServices } from "./LocalServices";

export function titleFor(url: string) {
  if (url === BROWSER_START) return "新标签页";
  try { return new URL(url).host; } catch { return url; }
}

export function BrowserView({ id, visible, initialUrl, onTitle }: { id: string; visible: boolean; initialUrl?: string; onTitle: (title: string) => void }) {
  const browser = useBrowser(id, initialUrl, visible);
  const { state, viewport } = browser;
  const [addr, setAddr] = useState(initialUrl ?? ""); const [inputError, setInputError] = useState("");
  const address = useRef<HTMLInputElement>(null); const titleCallback = useRef(onTitle); titleCallback.current = onTitle;
  useEffect(() => { setAddr(state.url === BROWSER_START ? "" : state.url); }, [state.url]);
  useEffect(() => { titleCallback.current(state.title || titleFor(state.url)); }, [state.title, state.url]);
  useEffect(() => window.rally.browser.onEvent(event => { if (visible && event.type === "shortcut" && event.key === "l") { address.current?.focus(); address.current?.select(); } }), [visible]);
  const go = (raw: string) => { try { setInputError(""); void browser.navigate(browserAddress(raw)); } catch (error) { setInputError(String(error)); } };
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(state.url);
  const notice = inputError || browser.error || state.notice;

  return <div className="flex h-full flex-col">
    <div className="flex h-11 shrink-0 items-center gap-1 px-2.5">
      <IconButton title="后退" onClick={() => void browser.action("back")} disabled={!browser.created || !state.canGoBack} className="disabled:opacity-30"><ArrowLeft size={15} /></IconButton>
      <IconButton title="前进" onClick={() => void browser.action("forward")} disabled={!browser.created || !state.canGoForward} className="disabled:opacity-30"><ArrowRight size={15} /></IconButton>
      <IconButton title={state.loading ? "停止加载" : "刷新"} disabled={!browser.created} onClick={() => void browser.action(state.loading ? "stop" : "reload")}>
        {state.loading ? <X size={14} /> : <RotateCw size={14} />}
      </IconButton>
      <IconButton title="起始页" disabled={!browser.created} onClick={() => go(BROWSER_START)}><Home size={14} /></IconButton>
      <form className="relative ml-1 flex h-8 flex-1 items-center rounded-full bg-sunken px-3 transition-all focus-within:bg-panel focus-within:shadow-[0_0_0_3px_var(--c-accent-soft),var(--s-soft)]" onSubmit={event => { event.preventDefault(); go(addr); }}>
        {state.url.startsWith("https://") ? <Lock size={12} className="shrink-0 text-faint" /> : isLocal ? <Server size={12} className="shrink-0 text-accent" /> : <Globe size={12} className="shrink-0 text-faint" />}
        <input ref={address} aria-label="网址" disabled={!browser.created} value={addr} onChange={event => setAddr(event.target.value)} onFocus={event => event.target.select()} placeholder="输入网址、localhost 端口或搜索内容" className="ml-2 h-full w-full bg-transparent text-[13px] text-fg placeholder:text-faint" />
        {state.loading && <div className="absolute bottom-0 left-4 right-4 h-0.5 overflow-hidden rounded-full"><div className="h-full w-1/3 animate-pulse rounded-full bg-accent" /></div>}
      </form>
      <IconButton title="在系统浏览器中打开" disabled={state.url === BROWSER_START || !browser.created} onClick={() => void browser.action("external")}><ExternalLink size={14} /></IconButton>
    </div>
    {notice && <div role="status" className="shrink-0 px-4 pb-2 text-xs text-muted">{notice}</div>}
    <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden rounded-b-[inherit] bg-panel">
      {state.error ? <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Globe size={32} className="text-faint" /><div className="text-sm font-medium">无法显示此页面</div><div className="break-all text-xs text-faint">{state.error}</div>
        <button className="rounded-lg bg-sunken px-3 py-2 text-xs hover:bg-hover" onClick={() => void browser.action("reload")}>重新加载</button>
      </div> : state.url === BROWSER_START ? <div className="h-full overflow-y-auto bg-panel"><div className="mx-auto max-w-[560px] px-6 pt-14">
        <div className="text-center text-2xl font-semibold tracking-tight">打开网页或本地服务</div><div className="mt-1.5 text-center text-sm text-faint">任务启动的服务会自动出现在这里</div>
        <div className="mt-8"><LocalServices onOpen={go} /></div>
      </div></div> : <div aria-hidden="true" className={cn("h-full bg-panel", state.loading && "animate-pulse")} />}
    </div>
  </div>;
}
