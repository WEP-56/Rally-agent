import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentBrowserWindow, BrowserFrame } from "../../shared/agent-browser";

let state: AgentBrowserWindow[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
async function refresh() {
	clearTimeout(timer);
	if (refreshing || document.hidden || !listeners.size) return;
	refreshing = true;
	try { state = await window.rally.agentBrowser.getState(); for (const changed of listeners) changed(); }
	catch (error) { console.error("任务浏览器状态读取失败", error); }
	finally { refreshing = false; if (listeners.size) timer = setTimeout(refresh, 3000); }
}
function subscribe(changed: () => void) {
	listeners.add(changed);
	if (listeners.size === 1) { void refresh(); document.addEventListener("visibilitychange", refresh); }
	return () => { listeners.delete(changed); if (!listeners.size) { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); } };
}
export function useAgentBrowsers() { return useSyncExternalStore(subscribe, () => state, () => state); }
export function updateAgentBrowser(next: AgentBrowserWindow) {
	state = state.map(item => item.id === next.id ? { ...item, ...next } : item);
	for (const changed of listeners) changed();
}

export function useBrowserFrame(id: string, enabled: boolean, interval = 3000, preview = false) {
	const [frame, setFrame] = useState<BrowserFrame>();
	const [error, setError] = useState("");
	const refreshNow = useRef<() => Promise<void>>(async () => {});
	useEffect(() => {
		let alive = true, busy = false;
		let timeout: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			clearTimeout(timeout);
			if (!enabled || document.hidden || busy || !alive) return;
			busy = true;
			try { const next = await window.rally.agentBrowser.frame(id, preview); if (alive) { setFrame(next); setError(""); } }
			catch (error) { if (alive) { setFrame(undefined); setError(error instanceof Error ? error.message : String(error)); } }
			finally { busy = false; if (alive) timeout = setTimeout(refresh, interval); }
		};
		refreshNow.current = refresh;
		setFrame(undefined); void refresh();
		document.addEventListener("visibilitychange", refresh);
		return () => { alive = false; clearTimeout(timeout); document.removeEventListener("visibilitychange", refresh); };
	}, [id, enabled, interval, preview]);
	return { frame, error, refresh: () => refreshNow.current(), clear: () => setFrame(undefined) };
}
