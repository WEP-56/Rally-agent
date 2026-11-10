export const BROWSER_START = "rally://start";
export interface BrowserState {
	id: string; revision: number; url: string; title: string; loading: boolean;
	canGoBack: boolean; canGoForward: boolean; error?: string; notice?: string;
}
export interface BrowserLayout { id: string; visible: boolean; x: number; y: number; width: number; height: number }
export type BrowserAction = "back" | "forward" | "reload" | "stop" | "external";
export type BrowserEvent = { type: "state"; state: BrowserState } | { type: "open"; url: string } | { type: "closed"; id: string } | { type: "shortcut"; key: "b" | "k" | "," | "1" | "2" | "3" | "l" };

/** Browser address input. Never convert an explicit unsupported scheme into a search. */
export function browserAddress(input: string): string {
	const value = input.trim();
	if (!value || value === BROWSER_START) return BROWSER_START;
	if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) return httpAddress(`http://${value}`);
	if (/^[a-z][a-z\d+.-]*:/i.test(value)) return httpAddress(value);
	if (/^[\w-]+(?:\.[\w-]+)+(?:[:/?#]|$)/.test(value)) return httpAddress(`https://${value}`);
	return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}
export function httpAddress(value: string): string {
	if (typeof value !== "string" || value.length > 16384) throw new Error("BROWSER_URL_INVALID: 网址无效");
	const url = new URL(value);
	if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("BROWSER_URL_INVALID: 仅支持不含用户名和密码的 HTTP/HTTPS 网址");
	return url.href;
}
