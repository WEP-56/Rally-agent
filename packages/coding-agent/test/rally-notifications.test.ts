import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { TaskNotifications } from "../../../src/main/notifications.ts";
import type { TaskView } from "../../../src/shared/task.ts";
import { IpcEvent } from "../../../src/shared/ipc.ts";

const state = vi.hoisted(() => ({
	supported: true,
	fail: false,
	shown: [] as {
		options: { title: string; body: string };
		handlers: Map<string, (...args: unknown[]) => void>;
		show: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	}[],
}));
vi.mock("electron", () => ({
	Notification: class {
		options;
		handlers = new Map<string, (...args: unknown[]) => void>();
		static isSupported() {
			return state.supported;
		}
		constructor(options: { title: string; body: string }) {
			this.options = options;
			state.shown.push(this);
		}
		on(event: string, callback: (...args: unknown[]) => void) {
			this.handlers.set(event, callback);
		}
		show = vi.fn(() => {
			if (state.fail) throw new Error("not available");
		});
		close = vi.fn();
	},
}));
vi.mock("../../../src/main/branding.ts", () => ({ applicationIcon: () => "fixture.ico" }));
const directories: string[] = [];
const managers: TaskNotifications[] = [];
afterEach(() => {
	for (const manager of managers.splice(0)) manager.dispose();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
	state.shown = [];
	state.supported = true;
	state.fail = false;
	vi.restoreAllMocks();
});
function setup() {
	const directory = mkdtempSync(join(tmpdir(), "rally-notifications-"));
	directories.push(directory);
	const window = {
		isDestroyed: () => false,
		isFocused: vi.fn(() => false),
		isVisible: () => true,
		isMinimized: () => true,
		restore: vi.fn(),
		show: vi.fn(),
		focus: vi.fn(),
		webContents: { isDestroyed: () => false, send: vi.fn() },
	};
	const file = join(directory, "notifications.json");
	const manager = new TaskNotifications(file, () => window as unknown as BrowserWindow);
	managers.push(manager);
	const task: TaskView = {
		id: "T-1",
		title: "测试",
		status: "running",
		statusText: "进行中",
		mode: "write",
		cwd: directory,
		scope: [],
		quotes: [],
		createdAt: 1,
		updatedAt: 1,
		dependsOn: [],
		approval: { state: "approved" },
		usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
		durationMs: 0,
	};
	const update = (patch: Partial<TaskView>) => manager.observe({ type: "task", task: { ...task, ...patch } });
	return { manager, task, update, file, window };
}
describe("task notification lifecycle", () => {
	it("suppresses startup recovery and snapshot replay, then deduplicates completion updates", () => {
		const { manager, task, update } = setup();
		const done = { ...task, ended: { outcome: "done" as const, at: 2, by: "worker" as const } };
		manager.observe({ type: "task", task: done });
		manager.start([done]);
		manager.observe({ type: "task", task: done });
		expect(state.shown).toHaveLength(0);
		manager.observe({
			type: "snapshot",
			board: { tasks: [{ ...done, id: "T-2" }], active: 0, limit: 3, autoApprove: false },
		});
		expect(state.shown).toHaveLength(0);
		update({});
		update({ ended: { outcome: "done", at: 3, by: "worker" } });
		update({ ended: { outcome: "done", at: 3, by: "worker" }, updatedAt: 4 });
		expect(state.shown).toHaveLength(1);
	});
	it("only notifies escalated questions/gates and withdraws resolved notices", () => {
		const { manager, task, update } = setup();
		manager.start([task]);
		const question = { id: "Q-1", runId: "R-1", question: "保留吗？", askedAt: 2 };
		update({ attention: question });
		expect(state.shown).toHaveLength(0);
		update({ attention: { ...question, escalatedAt: 3 } });
		expect(state.shown).toHaveLength(1);
		update({});
		expect(state.shown[0].close).toHaveBeenCalledOnce();
		const gate = {
			id: "G-1",
			runId: "R-1",
			toolCallId: "c",
			tool: "delete",
			action: "删除",
			cwd: task.cwd,
			scope: [],
			alternative: "保留",
			arguments: {},
			requestedAt: 4,
			expiresAt: 99,
		};
		update({ gates: [gate] });
		expect(state.shown).toHaveLength(1);
		update({ gates: [{ ...gate, escalatedAt: 5 }] });
		expect(state.shown).toHaveLength(2);
	});
	it("focuses the owning window and queues a consumable target even after toast timeout", () => {
		const { manager, task, update, window } = setup();
		manager.start([task]);
		update({ attention: { id: "Q-1", runId: "R-1", question: "原问题", askedAt: 2, escalatedAt: 3 } });
		const toast = state.shown[0];
		toast.handlers.get("close")?.();
		toast.handlers.get("click")!();
		expect(window.restore).toHaveBeenCalledOnce();
		expect(window.focus).toHaveBeenCalledOnce();
		expect(window.webContents.send).toHaveBeenCalledWith(IpcEvent.notification, undefined);
		expect(manager.takeTarget()).toEqual({ taskId: "T-1", cardId: "question-Q-1" });
		expect(manager.takeTarget()).toBeNull();
	});
	it("does not replay events suppressed while focused or after disposal", () => {
		const { manager, task, update, window } = setup();
		manager.start([task]);
		window.isMinimized = () => false;
		window.isFocused.mockReturnValue(true);
		const ended = { outcome: "done" as const, at: 2, by: "worker" as const };
		update({ ended });
		window.isFocused.mockReturnValue(false);
		update({ ended });
		expect(state.shown).toHaveLength(0);
		manager.dispose();
		update({ ended: { ...ended, at: 3 } });
		expect(state.shown).toHaveLength(0);
	});
	it("persists completion preference while retaining failure and blocked notifications", () => {
		const { manager, task, update, file } = setup();
		manager.start([task]);
		manager.update({ completed: false });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ completed: false });
		const loaded = new TaskNotifications(file, () => undefined);
		managers.push(loaded);
		expect(loaded.state()).toEqual({ completed: false });
		update({ ended: { outcome: "done", at: 2, by: "worker" } });
		expect(state.shown).toHaveLength(0);
		update({ ended: { outcome: "failed", at: 3, by: "system" } });
		update({ status: "blocked", lastReport: { state: "blocked", summary: "受阻", at: 4 } });
		expect(state.shown).toHaveLength(2);
		expect(() => manager.update({ completed: "false" })).toThrow();
	});
	it("notifies each blocked episode once and ignores callbacks from superseded native handles", () => {
		const { manager, task, update, window } = setup();
		manager.start([task]);
		update({ status: "blocked", lastReport: { state: "blocked", summary: "首次受阻", at: 2 } });
		update({ status: "blocked", lastReport: { state: "blocked", summary: "受阻进展", at: 3 } });
		expect(state.shown).toHaveLength(1);
		const old = state.shown[0];
		update({});
		update({ status: "blocked", lastReport: { state: "blocked", summary: "再次受阻", at: 4 } });
		expect(state.shown).toHaveLength(2);
		old.handlers.get("click")!();
		expect(window.focus).not.toHaveBeenCalled();
		expect(manager.takeTarget()).toBeNull();
		state.shown[1].handlers.get("click")!();
		expect(manager.takeTarget()).toEqual({ taskId: task.id });
	});
	it("withdraws pending decisions on cancellation without announcing cancelled or dropped outcomes", () => {
		const { manager, task, update } = setup();
		manager.start([task]);
		const attention = { id: "Q-1", runId: "R-1", question: "继续吗？", askedAt: 2, escalatedAt: 3 };
		update({ attention });
		update({ attention, ended: { outcome: "cancelled", at: 4, by: "system" } });
		expect(state.shown).toHaveLength(1);
		expect(state.shown[0].close).toHaveBeenCalledOnce();
		update({ ended: { outcome: "dropped", at: 5, by: "worker" } });
		expect(state.shown).toHaveLength(1);
	});
	it("bounds native handles and isolates unsupported/failed notification delivery", () => {
		const { manager, task, update } = setup();
		manager.start([task]);
		state.supported = false;
		update({ ended: { outcome: "done", at: 2, by: "worker" } });
		expect(state.shown).toHaveLength(0);
		state.supported = true;
		state.fail = true;
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => update({ ended: { outcome: "done", at: 3, by: "worker" } })).not.toThrow();
		expect(state.shown[0].close).toHaveBeenCalledOnce();
		state.fail = false;
		for (let n = 0; n < 34; n++)
			manager.observe({
				type: "task",
				task: { ...task, id: `T-${n + 2}`, ended: { outcome: "done", at: 4, by: "worker" } },
			});
		expect(state.shown[1].close).toHaveBeenCalledOnce();
		manager.dispose();
		expect(state.shown.at(-1)!.close).toHaveBeenCalledOnce();
	});
});
