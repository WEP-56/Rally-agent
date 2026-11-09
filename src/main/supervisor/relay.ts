// Relay queue: worker facts become <rally-event> messages for the main agent (docs 01 §4.2 / §5).
// Busy main agent gets a steer; idle main agent gets one coalesced turn after a short window.

import type { ReportState, Task, TaskAttention } from "../../shared/task.ts";
import type { EventLog } from "./event-log.ts";
import type { MainAgent } from "./main-agent.ts";

export type RelayInput =
	| { kind: "worker_report"; task: Task; state: ReportState; summary: string }
	| { kind: "worker_question"; task: Task; attention: TaskAttention }
	| { kind: "dependency_failed"; task: Task; upstream: Task }
	| { kind: "interrupted"; tasks: Task[] };

export class Relay {
	private readonly main: MainAgent;
	private readonly events: EventLog;
	private readonly queue: { id: string; text: string }[] = [];
	private timer: NodeJS.Timeout | null = null;
	private nextId = 1;

	constructor(main: MainAgent, events: EventLog) {
		this.main = main;
		this.events = events;
	}

	enqueue(input: RelayInput): void {
		const id = `R-${this.nextId++}`;
		const text = render(input);
		if (input.kind === "worker_report") this.main.addSystemLine(`${input.task.id} · ${input.task.title} · ${input.state === "ready" ? "已完成" : input.state === "failed" ? "失败" : input.state === "blocked" ? "受阻" : "无需处理"}`);
		if (input.kind === "worker_question") this.main.addSystemLine(`${input.task.id} 提问：${input.attention.question}`);
		this.events.append("relay_enqueued", { relayId: id, kind: input.kind });
		if (this.main.isBusy()) {
			this.events.append("relay_delivered", { relayId: id, mode: "steer" });
			void this.main.sendCustom(text, "steer");
			return;
		}
		this.queue.push({ id, text });
		this.timer ??= setTimeout(() => this.flush(), 2000);
	}

	/** A notice joins the next turn without waking the main agent. */
	notice(text: string): void {
		this.events.append("notice_enqueued", {});
		void this.main.sendCustom(`<rally-notice>${text}</rally-notice>`, "notice");
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.queue.length = 0;
	}

	private flush(): void {
		this.timer = null;
		const items = this.queue.splice(0, this.queue.length);
		if (items.length === 0) return;
		const mode = this.main.isBusy() ? "steer" : "turn";
		for (const item of items) this.events.append("relay_delivered", { relayId: item.id, mode });
		void this.main.sendCustom(items.map((item) => item.text).join("\n\n"), mode);
	}
}

function render(input: RelayInput): string {
	switch (input.kind) {
		case "worker_report":
			return reportEvent(input.task, input.state, input.summary);
		case "worker_question":
			return questionEvent(input.task, input.attention);
		case "dependency_failed":
			return dependencyEvent(input.task, input.upstream);
		case "interrupted":
			return interruptedEvent(input.tasks);
	}
}

function reportEvent(task: Task, state: ReportState, summary: string): string {
	const lastRun = task.runs[task.runs.length - 1];
	const title = `${task.title} · ${task.mode} · ${task.cwd}`;
	const changed = task.changedFiles?.length
		? `${task.changedFiles.slice(0, 6).join(", ")}${task.changedFiles.length > 6 ? ` (+${task.changedFiles.length - 6})` : ""}`
		: "(none)";
	return [
		`<rally-event kind="worker_report" task="${task.id}" state="${state}">`,
		`title: ${title}`,
		`summary: ${truncate(summary, 600)}`,
		`changed: ${changed}`,
		`outputs: ${task.outputDir}`,
		lastRun ? `more: task_read ${task.id} report` : "",
		"</rally-event>",
	]
		.filter(Boolean)
		.join("\n");
}

function questionEvent(task: Task, attention: TaskAttention): string {
	return [
		`<rally-event kind="worker_question" task="${task.id}" question="${attention.id}">`,
		`question: ${attention.question}`,
		attention.options?.length ? `options: ${attention.options.join(" | ")}` : "",
		"</rally-event>",
	]
		.filter(Boolean)
		.join("\n");
}

function dependencyEvent(task: Task, upstream: Task): string {
	const lastRun = upstream.runs[upstream.runs.length - 1];
	const summary = lastRun?.lastReport?.summary;
	return [
		`<rally-event kind="dependency_failed" task="${task.id}" upstream="${upstream.id}" upstream_outcome="${upstream.ended?.outcome ?? "unknown"}">`,
		summary ? `upstream summary: ${truncate(summary, 600)}` : "upstream summary: （无汇报）",
		"</rally-event>",
	].join("\n");
}

function interruptedEvent(tasks: Task[]): string {
	return [
		`<rally-event kind="interrupted" tasks="${tasks.map((task) => task.id).join(",")}">`,
		"Rally 重启时这些任务正在运行。",
		"</rally-event>",
	].join("\n");
}

function truncate(text: string, max: number): string {
	const chars = [...text];
	return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}
