import { IpcChannel as C } from "../../shared/ipc.ts";
import type { BrowserFrame, BrowserUserInput } from "../../shared/agent-browser.ts";
import type { AgentBrowserService } from "./service.ts";

export const AGENT_BROWSER_COMMANDS = new Set<string>([C.agentBrowserState, C.agentBrowserFrame, C.agentBrowserTake, C.agentBrowserReturn, C.agentBrowserInput, C.agentBrowserDisconnect, C.agentBrowserHeartbeat]);
export function browserCommand(browser: AgentBrowserService, device: string, channel: string, args: unknown[]): unknown {
	if (!device) throw Error("浏览器操作缺少设备身份");
	if (channel === C.agentBrowserState) return browser.state();
	if (channel === C.agentBrowserDisconnect && args[0] === undefined) return browser.disconnect(device);
	const id = args[0]; if (typeof id !== "string" || id.length > 100) throw Error("无效窗口编号");
	if (channel === C.agentBrowserDisconnect) return browser.disconnect(device, id);
	if (channel === C.agentBrowserHeartbeat) return browser.heartbeat(id, device);
	if (channel === C.agentBrowserFrame) { if (args[1] !== undefined && typeof args[1] !== "boolean") throw Error("画面参数无效"); return browser.frame(id, args[1] as boolean | undefined, device); }
	if (channel === C.agentBrowserTake) return browser.take(id, device);
	if (channel === C.agentBrowserReturn) return browser.handBack(id, device);
	if (channel === C.agentBrowserInput) {
		const frame = args[1] as Pick<BrowserFrame, "epoch" | "document" | "seq">;
		const input = args[2] as BrowserUserInput;
		if (!frame || ![frame.epoch, frame.document, frame.seq].every(Number.isSafeInteger) || !input) throw Error("输入格式无效");
		if (input.kind === "click" || input.kind === "scroll") { if (![input.x, input.y].every(value => Number.isFinite(value) && Math.abs(value) <= 100000)) throw Error("坐标无效"); }
		else if (input.kind === "drag") { if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 128 || input.points.some(point => !point || ![point.x, point.y].every(Number.isFinite))) throw Error("拖动轨迹无效"); }
		else if (input.kind === "text") { if (typeof input.text !== "string" || input.text.length > 32000) throw Error("输入文字无效"); }
		else if (input.kind === "key") { if (typeof input.key !== "string" || input.key.length > 100) throw Error("按键无效"); }
		else if (input.kind === "tab") { if (typeof input.tabId !== "string" || input.tabId.length > 100) throw Error("标签页无效"); }
		else throw Error("不支持的输入类型");
		return browser.input(id, device, frame, input);
	}
	throw Error("不支持的浏览器操作");
}
