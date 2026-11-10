import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Notification, type BrowserWindow } from "electron";
import { IpcEvent, type TaskEvent } from "../shared/ipc.ts";
import type { NotificationSettings, NotificationTarget } from "../shared/notifications.ts";
import type { TaskView } from "../shared/task.ts";
import { applicationIcon } from "./branding.ts";

interface Notice {
	key: string;
	title: string;
	body: string;
	target: NotificationTarget;
	completed?: boolean;
}
function notices(task: TaskView): Notice[] {
	const result: Notice[] = [];
	const add = (key: string, title: string, body: string, cardId?: string, completed = false) =>
		result.push({
			key: `${task.id}:${key}`,
			title,
			body: `${task.id} · ${task.title}\n${body}`.slice(0, 512),
			target: { taskId: task.id, cardId },
			completed,
		});
	const question = task.attention;
	if (!task.ended && question?.escalatedAt !== undefined && !question.answer && !question.closed)
		add(question.id, "Rally · 需要回答", question.question, `question-${question.id}`);
	for (const gate of task.gates ?? [])
		if (!task.ended && gate.escalatedAt !== undefined && !gate.decision)
			add(gate.id, "Rally · 需要确认", gate.action, `gate-${gate.id}`);
	if (task.ended?.outcome === "done")
		add(`done:${task.ended.at}`, "Rally · 任务完成", task.lastReport?.summary ?? "任务已完成", undefined, true);
	else if (task.ended?.outcome === "failed")
		add(`failed:${task.ended.at}`, "Rally · 任务失败", task.lastReport?.summary ?? "请查看任务详情");
	else if (!task.ended && task.status === "blocked" && (!question || question.answer || question.closed))
		add("blocked", "Rally · 任务受阻", task.lastReport?.summary ?? task.statusText);
	return result;
}

/** Native notifications are an ephemeral projection; task facts remain authoritative. */
export class TaskNotifications {
	private readonly seen = new Map<string, Set<string>>();
	private readonly active = new Map<string, { taskId: string; notification: Notification; completed: boolean }>();
	private settings: NotificationSettings = { completed: true };
	private started = false;
	private disposed = false;
	private pending: NotificationTarget | null = null;
	constructor(privateFile: string, window: () => BrowserWindow | undefined) {
		this.file = privateFile;
		this.window = window;
		try {
			if (existsSync(this.file)) {
				const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
				if (saved && typeof saved === "object" && "completed" in saved && typeof saved.completed === "boolean")
					this.settings = { completed: saved.completed };
			}
		} catch (error) {
			console.error("Notification settings unavailable", error);
		}
	}
	private readonly file: string;
	private readonly window: () => BrowserWindow | undefined;
	state(): NotificationSettings {
		return { ...this.settings };
	}
	update(value: unknown): NotificationSettings {
		if (this.disposed) throw new Error("Notifications closed");
		if (!value || typeof value !== "object" || !("completed" in value) || typeof value.completed !== "boolean")
			throw new Error("通知设置无效");
		const next = { completed: value.completed };
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
		renameSync(`${this.file}.tmp`, this.file);
		this.settings = next;
		if (!next.completed) for (const [key, item] of this.active) if (item.completed) this.dismiss(key);
		return this.state();
	}
	start(tasks: TaskView[]): void {
		if (this.disposed || this.started) return;
		for (const task of tasks) this.seen.set(task.id, new Set(notices(task).map((item) => item.key)));
		this.started = true;
	}
	observe(event: TaskEvent): void {
		if (!this.started || this.disposed || event.type !== "task") return;
		try {
			const task = event.task;
			const next = notices(task);
			const keys = new Set(next.map((item) => item.key));
			const previous = this.seen.get(task.id) ?? new Set<string>();
			this.seen.set(task.id, keys);
			for (const [key, item] of this.active) if (item.taskId === task.id && !keys.has(key)) this.dismiss(key);
			const window = this.window();
			if (
				!window ||
				window.isDestroyed() ||
				(window.isFocused() && window.isVisible() && !window.isMinimized()) ||
				!Notification.isSupported()
			)
				return;
			for (const item of next)
				if (!previous.has(item.key) && (!item.completed || this.settings.completed)) this.show(item);
		} catch (error) {
			console.error("Task notification failed", error);
		}
	}
	private show(item: Notice): void {
		while (this.active.size >= 32) this.dismiss(this.active.keys().next().value!);
		const notification = new Notification({ title: item.title, body: item.body, icon: applicationIcon() });
		this.active.set(item.key, { taskId: item.target.taskId, notification, completed: Boolean(item.completed) });
		notification.on("click", () => {
			if (this.disposed || this.active.get(item.key)?.notification !== notification) return;
			const window = this.window();
			if (!window || window.isDestroyed()) return;
			this.pending = item.target;
			try {
				if (window.isMinimized()) window.restore();
				window.show();
				window.focus();
				if (!window.webContents.isDestroyed()) window.webContents.send(IpcEvent.notification, undefined);
			} catch (error) {
				console.error("Notification navigation failed", error);
			} finally {
				this.dismiss(item.key);
			}
		});
		// Windows may fire close at timeout while retaining the toast in Action Center.
		// Keep its click listener until superseded, explicitly dismissed, or bounded eviction.
		notification.on("failed", (_event, error) => {
			console.error("Native notification failed", error);
			if (this.active.get(item.key)?.notification === notification) this.dismiss(item.key);
		});
		try {
			notification.show();
		} catch (error) {
			this.dismiss(item.key);
			throw error;
		}
	}
	takeTarget(): NotificationTarget | null {
		const target = this.pending;
		this.pending = null;
		return target;
	}
	private dismiss(key: string): void {
		const item = this.active.get(key);
		this.active.delete(key);
		try {
			item?.notification.close();
		} catch (error) {
			console.error("Notification close failed", error);
		}
	}
	dispose(): void {
		this.disposed = true;
		this.pending = null;
		for (const key of this.active.keys()) this.dismiss(key);
		this.seen.clear();
	}
}
