import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BROWSER_START, type BrowserState, type BrowserAction, type BrowserLayout } from "../../shared/browser";
import { useBrowserObscured } from "./browser-overlays";

export function browserRectangle(element: HTMLElement): Omit<BrowserLayout, "id" | "visible"> {
	const own = element.getBoundingClientRect(); let left = own.left; let top = own.top; let right = own.right; let bottom = own.bottom;
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		const style = getComputedStyle(parent); const box = parent.getBoundingClientRect();
		if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
		if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
	}
	left = Math.max(0, left); top = Math.max(0, top); right = Math.min(window.innerWidth, right); bottom = Math.min(window.innerHeight, bottom);
	return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function useBrowser(id: string, initialUrl: string | undefined, visible: boolean) {
	const [state, setState] = useState<BrowserState>({ id, revision: 0, url: initialUrl ?? BROWSER_START, title: "新标签页", loading: false, canGoBack: false, canGoForward: false });
	const [created, setCreated] = useState(false); const [error, setError] = useState("");
	const viewport = useRef<HTMLDivElement>(null); const initial = useRef(initialUrl); const obscured = useBrowserObscured();
	const update = (next: BrowserState) => setState(current => next.revision >= current.revision ? next : current);
	useEffect(() => {
		let mounted = true; const api = window.rally.browser;
		const off = api.onEvent(event => { if (mounted && event.type === "state" && event.state.id === id) update(event.state); });
		void api.create(id, initial.current).then(next => { if (mounted) { update(next); setCreated(true); } }).catch(reason => { if (mounted) setError(String(reason)); });
		return () => { mounted = false; off(); void api.layout({ id, visible: false, x: 0, y: 0, width: 0, height: 0 }).catch(() => {}); };
	}, [id]);
	useLayoutEffect(() => {
		if (!created) return;
		const element = viewport.current; let previous = "";
		const measure = () => {
			const layout = { id, visible: visible && !obscured && document.visibilityState !== "hidden", ...(element ? browserRectangle(element) : { x: 0, y: 0, width: 0, height: 0 }) };
			const serialized = JSON.stringify(layout); if (serialized === previous) return; previous = serialized;
			void window.rally.browser.layout(layout).catch(reason => setError(String(reason)));
		};
		measure(); const observer = new ResizeObserver(measure);
		for (let node: HTMLElement | null = element; node; node = node.parentElement) observer.observe(node);
		window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true); document.addEventListener("visibilitychange", measure);
		return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); document.removeEventListener("visibilitychange", measure); };
	}, [id, created, visible, obscured]);
	const request = async (work: () => Promise<BrowserState>) => { setError(""); try { update(await work()); } catch (reason) { setError(String(reason)); } };
	return { state, error, viewport, created, navigate: (url: string) => request(() => window.rally.browser.navigate(id, url)), action: (action: BrowserAction) => request(() => window.rally.browser.action(id, action)) };
}
