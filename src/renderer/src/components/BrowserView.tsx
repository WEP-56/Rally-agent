import { useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, ExternalLink, Server, Star, Home, Info } from "lucide-react";
import { cn } from "../utils/cn";
import { IconButton } from "./ui";

const START = "rally://start";

function normalize(input: string) {
  const s = input.trim();
  if (!s) return START;
  if (s.startsWith("rally://")) return s;
  if (/^https?:\/\//.test(s)) return s;
  if (/^localhost(:\d+)?/.test(s) || /^127\.0\.0\.1/.test(s)) return "http://" + s;
  if (/^[\w-]+(\.[\w-]+)+/.test(s)) return "https://" + s;
  return "https://www.bing.com/search?q=" + encodeURIComponent(s);
}

export function titleFor(url: string) {
  if (url === START) return "新标签页";
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

function StartPage({ go }: { go: (u: string) => void }) {
  const local = [
    { url: "http://localhost:5173", name: "landing (Vite)", by: "T-1043 启动", live: true },
    { url: "http://localhost:3000", name: "api-server", by: "未运行", live: false },
  ];
  const marks = [
    { url: "https://example.com", name: "Example" },
    { url: "https://developer.mozilla.org", name: "MDN" },
    { url: "https://github.com", name: "GitHub" },
    { url: "https://vitejs.dev", name: "Vite" },
  ];
  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-[560px] px-6 pt-14">
        <div className="text-center text-2xl font-semibold tracking-tight">打开网页或本地服务</div>
        <div className="mt-1.5 text-center text-sm text-faint">Rally 和工位任务启动的服务会自动出现在这里</div>

        <div className="mt-8 text-xs font-medium text-faint">本地服务</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {local.map((l) => (
            <button key={l.url} onClick={() => go(l.url)} className="flex items-center gap-3 rounded-xl bg-sunken px-3.5 py-3 text-left transition-all hover:bg-deep hover:shadow-soft dark:hover:bg-raised">
              <Server size={15} className="text-faint" />
              <div className="flex-1">
                <div className="font-mono text-[13px]">{l.url}</div>
                <div className="text-[11px] text-faint">{l.name} · {l.by}</div>
              </div>
              <span className={cn("h-2 w-2 rounded-full", l.live ? "bg-accent" : "bg-press")} />
            </button>
          ))}
        </div>

        <div className="mt-7 text-xs font-medium text-faint">书签</div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {marks.map((m) => (
            <button key={m.url} onClick={() => go(m.url)} className="flex flex-col items-center gap-2 rounded-xl px-2 py-4 transition-colors hover:bg-hover">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-sm font-semibold text-muted shadow-soft">{m.name[0]}</div>
              <span className="text-xs text-muted">{m.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LocalPreview({ url }: { url: string }) {
  if (url.includes(":3000"))
    return (
      <div className="flex h-full flex-col items-center justify-center bg-panel text-center">
        <Globe size={34} className="text-faint" />
        <div className="mt-3 text-sm font-medium">无法访问此页面</div>
        <div className="mt-1 text-xs text-faint">localhost 拒绝了连接 · ERR_CONNECTION_REFUSED</div>
      </div>
    );
  return (
    <div className="h-full overflow-y-auto bg-[#0e1012] text-white">
      <div className="flex items-center justify-between px-8 py-5 text-sm">
        <span className="font-semibold tracking-tight">◆ Northwind</span>
        <div className="hidden gap-6 text-white/60 sm:flex"><span>产品</span><span>定价</span><span>文档</span></div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black">开始使用</span>
      </div>
      <div className="px-8 pb-16 pt-[clamp(32px,8vw,90px)] text-center">
        <div className="mx-auto inline-block rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/70">v2 · 响应式重构预览</div>
        <h1 className="mx-auto mt-5 max-w-xl text-[clamp(28px,5vw,52px)] font-semibold leading-[1.05] tracking-tight">把复杂工作流，变成一次点击</h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-white/55">由 Rally 工位任务 T-1043 实时构建 · 适配 375 / 768 / 1440</p>
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
          {["极速部署", "团队协作", "可观测性"].map((f) => (
            <div key={f} className="rounded-2xl bg-white/[0.06] p-5 text-left">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600" />
              <div className="mt-3 text-sm font-medium">{f}</div>
              <div className="mt-1 text-xs text-white/50">clamp() 流式排版与弹性网格</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BrowserView({ initialUrl, onTitle }: { initialUrl?: string; onTitle: (t: string) => void }) {
  const [hist, setHist] = useState<string[]>([initialUrl || START]);
  const [idx, setIdx] = useState(0);
  const [addr, setAddr] = useState(initialUrl && initialUrl !== START ? initialUrl : "");
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const url = hist[idx];

  const go = (raw: string) => {
    const u = normalize(raw);
    const h = [...hist.slice(0, idx + 1), u];
    setHist(h);
    setIdx(h.length - 1);
    setAddr(u === START ? "" : u);
    onTitle(titleFor(u));
    setLoading(true);
    setTimeout(() => setLoading(false), 600);
  };
  const move = (d: number) => {
    const i = idx + d;
    if (i < 0 || i >= hist.length) return;
    setIdx(i);
    setAddr(hist[i] === START ? "" : hist[i]);
    onTitle(titleFor(hist[i]));
  };

  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)/.test(url);
  const secure = url.startsWith("https://");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2.5">
        <IconButton onClick={() => move(-1)} disabled={idx === 0} className="disabled:opacity-30"><ArrowLeft size={15} /></IconButton>
        <IconButton onClick={() => move(1)} disabled={idx >= hist.length - 1} className="disabled:opacity-30"><ArrowRight size={15} /></IconButton>
        <IconButton onClick={() => { setNonce((n) => n + 1); setLoading(true); setTimeout(() => setLoading(false), 500); }}>
          <RotateCw size={14} className={cn(loading && "animate-spin")} />
        </IconButton>
        <IconButton onClick={() => go(START)}><Home size={14} /></IconButton>
        <form
          className="relative ml-1 flex h-8 flex-1 items-center rounded-full bg-sunken px-3 transition-all focus-within:bg-panel focus-within:shadow-[0_0_0_3px_var(--c-accent-soft),var(--s-soft)]"
          onSubmit={(e) => {
            e.preventDefault();
            go(addr);
          }}
        >
          {secure ? <Lock size={12} className="shrink-0 text-faint" /> : isLocal ? <Server size={12} className="shrink-0 text-accent" /> : <Globe size={12} className="shrink-0 text-faint" />}
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="输入网址、localhost 端口或搜索内容"
            className="ml-2 h-full w-full bg-transparent text-[13px] text-fg placeholder:text-faint"
          />
          <Star size={13} className="shrink-0 text-faint" />
          {loading && <div className="absolute bottom-0 left-4 right-4 h-0.5 overflow-hidden rounded-full"><div className="h-full w-1/3 animate-[drawer_0.6s_ease-out] rounded-full bg-accent" /></div>}
        </form>
        <IconButton title="在系统浏览器中打开" onClick={() => url !== START && window.open(url, "_blank")}>
          <ExternalLink size={14} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-[inherit] bg-panel">
        {url === START ? (
          <StartPage go={go} />
        ) : isLocal ? (
          <LocalPreview key={nonce} url={url} />
        ) : (
          <>
            <iframe key={url + nonce} src={url} className="h-full w-full bg-white" title="browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex justify-center">
              <div className="flex items-center gap-1.5 rounded-full bg-raised/95 px-3 py-1.5 text-[11px] text-muted shadow-pop">
                <Info size={12} />部分网站禁止嵌入显示，可点击右上角在系统浏览器中打开
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
