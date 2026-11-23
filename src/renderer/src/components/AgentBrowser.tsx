import { useEffect, useRef, useState } from "react";
import { Globe, Hand, Play, X } from "lucide-react";
import type { AgentBrowserWindow, BrowserFrame, BrowserUserInput } from "../../../shared/agent-browser";
import { useAgentBrowsers, useBrowserFrame, updateAgentBrowser } from "../agent-browser";
import { useApp } from "../store";
import { Button } from "./ui";

export function AgentBrowserCard({ browser }: { browser: AgentBrowserWindow }) {
	const { openAgentBrowser } = useApp();
	const element = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
		observer.observe(element.current!); return () => observer.disconnect();
	}, []);
	const { frame, error } = useBrowserFrame(browser.id, visible && browser.owner === "agent", 3000, true);
	return <div ref={element} className="ml-8 max-w-[440px] overflow-hidden rounded-[22px] bg-panel p-4 shadow-soft">
		<div className="flex items-center gap-2 text-sm font-medium"><Globe size={16} className="text-accent" />任务浏览器<span className="ml-auto text-xs text-faint">{browser.taskId}</span></div>
		<div className="my-2 truncate text-xs text-muted">{browser.operation}</div>
		<div className="flex aspect-[8/5] items-center justify-center overflow-hidden rounded-xl bg-sunken text-xs text-faint">
			{frame && browser.owner === "agent" ? <img src={`data:image/jpeg;base64,${frame.data}`} alt="任务浏览器当前画面" className="h-full w-full object-contain" /> : browser.owner === "closed" ? "浏览器已结束" : error || (browser.owner === "agent" ? "正在获取画面…" : "私密操作中，缩略图已暂停")}
		</div>
		<div className="mt-3 flex items-center justify-between gap-2"><span className="truncate text-xs text-faint">{browser.origin}</span><Button size="sm" onClick={() => openAgentBrowser(browser.id, browser.taskId)}>打开浏览器</Button></div>
	</div>;
}

export function AgentBrowserView({ id, visible, onClose }: { id: string; visible: boolean; onClose?: () => void }) {
	const browsers = useAgentBrowsers();
	const browser = browsers.find(browser => browser.id === id);
	const [ownedEpoch, setOwnedEpoch] = useState<number>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [text, setText] = useState("");
	const gesture = useRef<{ frame: BrowserFrame; points: { x: number; y: number }[] } | undefined>(undefined);
	const owned = browser?.owner === "user" && browser.epoch === ownedEpoch;
	const image = useBrowserFrame(id, visible && browser?.owner !== "closed", 500);
	useEffect(() => {
		if (!visible) { setOwnedEpoch(undefined); setText(""); }
		return () => { void window.rally.agentBrowser.disconnect(id).catch(error => setError(String(error))); };
	}, [id, visible]);
	useEffect(() => {
		if (!visible || !owned) return;
		const heartbeat = () => {
			if (document.hidden) { setOwnedEpoch(undefined); setText(""); void window.rally.agentBrowser.disconnect(id).catch(error => setError(String(error))); return; }
			void window.rally.agentBrowser.heartbeat(id).catch(error => { setOwnedEpoch(undefined); setError(String(error)); });
		};
		const timer = setInterval(heartbeat, 3000);
		document.addEventListener("visibilitychange", heartbeat);
		return () => { clearInterval(timer); document.removeEventListener("visibilitychange", heartbeat); };
	}, [id, visible, owned]);
	const action = async (fn: () => Promise<unknown>) => {
		if (pending) return; setPending(true); setError("");
		try { await fn(); await image.refresh(); }
		catch (error) { setError(error instanceof Error ? error.message : String(error)); image.clear(); }
		finally { setPending(false); }
	};
	const send = (input: BrowserUserInput, frame = image.frame) => {
		if (!owned || !frame) return;
		void action(async () => { await window.rally.agentBrowser.input(id, frame, input); image.clear(); });
	};
	const point = (element: HTMLImageElement, clientX: number, clientY: number, frame: BrowserFrame) => {
		const rect = element.getBoundingClientRect();
		return { x: Math.max(0, Math.min(frame.width - 1, (clientX - rect.left) * frame.width / rect.width)), y: Math.max(0, Math.min(frame.height - 1, (clientY - rect.top) * frame.height / rect.height)) };
	};
	return <div className="flex h-full min-h-0 flex-col gap-3 p-4">
		<div className="flex flex-wrap items-center gap-2 text-sm"><Globe size={16} className="text-accent" /><span className="min-w-0 flex-1 truncate">{browser?.origin || "任务浏览器"}</span>
			{browser && browser.owner !== "closed" && (owned ? <Button size="sm" disabled={pending} onClick={() => void action(async () => { updateAgentBrowser(await window.rally.agentBrowser.handBack(id)); setOwnedEpoch(undefined); setText(""); })}><Play size={13} />交还</Button> : <Button size="sm" disabled={pending || browser.owner === "user" || browser.owner === "taking"} onClick={() => void action(async () => { const next = await window.rally.agentBrowser.take(id); updateAgentBrowser(next); setOwnedEpoch(next.epoch); })}><Hand size={13} />接管</Button>)}
			{onClose && <button aria-label="关闭浏览器视图" onClick={onClose}><X size={18} /></button>}
		</div>
		<div className="text-xs text-muted">{browser?.operation || "正在连接…"}{browser?.owner !== "closed" && !owned && " · 仅观看"}</div>
		{(browser?.tabs?.length ?? 0) > 1 && <div className="flex gap-2 overflow-auto">{browser!.tabs!.map((tab, index) => <Button key={tab.id} size="sm" disabled={!owned || pending || tab.active} onClick={() => send({ kind: "tab", tabId: tab.id })}>{index + 1} · {tab.origin || "新标签页"}</Button>)}</div>}
		<div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-sunken">
			{image.frame && browser?.owner !== "closed" ? <img alt="任务浏览器画面" draggable={false} tabIndex={owned ? 0 : -1} src={`data:image/jpeg;base64,${image.frame.data}`} className={`w-full ${owned ? "cursor-crosshair touch-none" : ""}`}
				onPointerDown={event => { if (!owned || pending || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { frame: image.frame!, points: [point(event.currentTarget, event.clientX, event.clientY, image.frame!)] }; }}
				onPointerMove={event => { const drag = gesture.current; if (!drag) return; const next = point(event.currentTarget, event.clientX, event.clientY, drag.frame); if (drag.points.length < 127) drag.points.push(next); else drag.points[126] = next; }}
				onPointerUp={event => { const drag = gesture.current; gesture.current = undefined; if (!drag) return; const last = point(event.currentTarget, event.clientX, event.clientY, drag.frame); drag.points.push(last); const first = drag.points[0]; send(drag.points.every(point => Math.hypot(point.x - first.x, point.y - first.y) < 3) ? { kind: "click", ...last } : { kind: "drag", points: drag.points }, drag.frame); }}
				onPointerCancel={() => { gesture.current = undefined; }} onLostPointerCapture={() => { gesture.current = undefined; }} onBlur={() => { gesture.current = undefined; }}
				onKeyDown={event => { if (!owned || pending || event.nativeEvent.isComposing || ["Shift", "Control", "Meta", "Alt"].includes(event.key)) return; event.preventDefault(); const modifiers = [event.ctrlKey && "Control", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean); send({ kind: "key", key: [...modifiers, event.key === " " ? "Space" : event.key].join("+") }); }}
				onWheel={event => { if (owned) send({ kind: "scroll", x: event.deltaX, y: event.deltaY }); }} /> : <div className="p-8 text-center text-sm text-faint">{browser?.owner === "closed" ? "此任务的浏览器已关闭" : "正在获取画面…"}</div>}
		</div>
		{owned && <div className="flex flex-col gap-2"><form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (text) { send({ kind: "text", text }); setText(""); } }}><input aria-label="输入到网页当前焦点" autoComplete="off" type="password" value={text} onChange={event => setText(event.target.value)} placeholder="输入文字到网页选中位置（支持中文）" className="min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2 text-sm" /><Button type="submit" size="sm" disabled={pending || !text}>输入</Button></form><div className="flex flex-wrap gap-2">{["Tab", "Enter", "Backspace", "Escape", "ControlOrMeta+A"].map(key => <Button key={key} size="sm" disabled={pending} onClick={() => send({ kind: "key", key })}>{key === "ControlOrMeta+A" ? "全选" : key}</Button>)}<Button size="sm" disabled={pending} onClick={() => send({ kind: "scroll", x: 0, y: -500 })}>向上滚动</Button><Button size="sm" disabled={pending} onClick={() => send({ kind: "scroll", x: 0, y: 500 })}>向下滚动</Button></div></div>}
		{(error || image.error) && <p role="alert" className="text-xs text-danger">{error || image.error}</p>}
	</div>;
}
