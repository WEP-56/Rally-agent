import { afterEach, expect, it, vi } from "vitest";
import "../../../../src/main/index.ts";

const state = vi.hoisted(() => {
	const agentDir = process.env.RALLY_CODING_AGENT_DIR;
	vi.stubEnv("RALLY_SMOKE", "0");
	let ready!: () => void; const whenReady = new Promise<void>(resolve => { ready = resolve; });
	let armed!: () => void; const arm = new Promise<void>(resolve => { armed = resolve; });
	let stopped!: () => void; const requests = new Promise<void>(resolve => { stopped = resolve; });
	let closed!: () => void; const sessions = new Promise<void>(resolve => { closed = resolve; });
	const order: string[] = []; const listeners = new Map<string, (...args: unknown[]) => void>();
	return { agentDir, ready, whenReady, armed, arm, stopped, requests, closed, sessions, order, listeners,
		exit: vi.fn(), dispose: vi.fn(async (pending: Promise<void>) => { order.push("supervisor"); await Promise.all([pending, sessions]); order.push("saved"); }), windows: vi.fn(), cancel: vi.fn(async () => { order.push("cancelled"); }) };
});
vi.mock("electron", () => ({
	app: { requestSingleInstanceLock: () => true, whenReady: () => state.whenReady, on: (name: string, callback: (...args: unknown[]) => void) => state.listeners.set(name, callback), exit: state.exit },
	BrowserWindow: state.windows, nativeTheme: { shouldUseDarkColors: false }, dialog: {}, shell: {},
}));
vi.mock("../../../../src/main/paths.ts", () => ({ ensureRallyDirs: () => {}, resolveRallyPaths: () => ({ agentDir: "fixture" }) }));
vi.mock("../../../../src/main/smoke.ts", () => ({ runSmoke: vi.fn() }));
vi.mock("../../../../src/main/supervisor/index.ts", () => ({ Supervisor: class { start() { return new Promise<void>(() => {}); } dispose(pending: Promise<void>) { return state.dispose(pending); } } }));
vi.mock("../../../../src/main/shutdown-guard.ts", () => ({ ProcessShutdownGuard: class { arm() { state.order.push("arm"); return state.arm; } cancel() { return state.cancel(); } } }));
vi.mock("../../../../src/main/ipc.ts", () => ({
	broadcastChat: vi.fn(), broadcastTask: vi.fn(), broadcastWorkspace: vi.fn(), broadcastServices: vi.fn(), forwardWindowState: vi.fn(),
	registerIpc: () => () => { state.order.push("ipc"); return state.requests; },
}));

afterEach(() => {
	vi.restoreAllMocks(); vi.unstubAllEnvs();
	if (state.agentDir === undefined) delete process.env.RALLY_CODING_AGENT_DIR; else process.env.RALLY_CODING_AGENT_DIR = state.agentDir;
});
it("routes repeated Electron quit requests through the guard before concurrent IPC/session cleanup", async () => {
	state.ready(); await vi.waitFor(() => expect(state.listeners.has("before-quit")).toBe(true));
	const event = { preventDefault: vi.fn() }; const quit = state.listeners.get("before-quit")!;
	quit(event); quit(event); await vi.waitFor(() => expect(state.order).toEqual(["arm"]));
	expect(event.preventDefault).toHaveBeenCalledTimes(2); expect(state.dispose).not.toHaveBeenCalled();
	state.armed(); await vi.waitFor(() => expect(state.order).toEqual(["arm", "ipc", "supervisor"]));
	state.stopped(); await Promise.resolve(); expect(state.exit).not.toHaveBeenCalled();
	state.closed(); await vi.waitFor(() => expect(state.exit).toHaveBeenCalledExactlyOnceWith(0));
	expect(state.order).toEqual(["arm", "ipc", "supervisor", "saved", "cancelled"]); expect(state.windows).not.toHaveBeenCalled();
});
