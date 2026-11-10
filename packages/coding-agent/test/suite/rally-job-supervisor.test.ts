import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("Rally background jobs in production sessions (faux provider)", () => {
	const harnesses: Harness[] = []; const supervisors: Supervisor[] = [];
	afterEach(async () => { await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose())); vi.unstubAllEnvs(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup() {
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness({ provider: "rally-job-test", models: [{ id: "main" }, { id: "worker" }] }); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, limit: 1, jobForegroundSeconds: 0.04, jobStopGraceMs: 50 }); supervisors.push(supervisor);
		await supervisor.models.save([{ id: "rally-job-test", name: "Offline jobs", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady(); if (!runtime) throw new Error("missing runtime");
		runtime.registerProvider("rally-job-test", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-job-test", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "rally-job-test", model: "worker", thinkingLevel: "off" }); await supervisor.start();
		const task = (title: string) => supervisor.store.create({ title, cwd: paths.workspaceDir, mode: "write", scope: [], dependsOn: [], autoApprove: false, quotes: [{ messageId: "#fixture", kind: "user", text: "run fixture", at: Date.now() }] }).task;
		const gate = join(harness.tempDir, "release.json");
		const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
		const command = `& ${quote(process.execPath)} ${quote(fileURLToPath(new URL("../fixtures/rally-job.cjs", import.meta.url)))} ${quote(gate)}`;
		return { harness, paths, supervisor, task, gate, command };
	}

	it("holds one slot without nudging, accepts input within that slot, then wakes the same worker before new work", async () => {
		const { harness, supervisor, task, gate, command } = await setup(); const first = task("FIRST_JOB"); const second = task("QUEUED_JOB");
		let commands = 0; let completions = 0; let steers = 0; let secondStarted = false;
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("已收到结果。");
			const user = getMessageText(context.messages.findLast(message => message.role === "user"));
			const tool = context.messages.findLast(message => message.role === "toolResult");
			if (tool?.role === "toolResult" && tool.toolName === "task_report") return fauxAssistantMessage("完成。");
			if (user.includes("QUEUED_JOB")) { secondStarted = true; return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "queued work completed" }), { stopReason: "toolUse" }); }
			if (user.includes("<rally-job")) { completions++; expect(user).toContain("JOB_FINISHED_SENTINEL"); return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "job completed" }), { stopReason: "toolUse" }); }
			if (user.includes("STEER_DURING_JOB")) { steers++; return fauxAssistantMessage("继续等待作业。"); }
			if (tool?.role === "toolResult" && tool.toolName === "powershell") { expect(getMessageText(tool)).toContain('"background":true'); return fauxAssistantMessage("后台运行中，本轮结束。"); }
			expect(getCurrentTools(context.messages).map(tool => tool.name)).toEqual(expect.arrayContaining(["job_output", "job_kill"]));
			commands++; return fauxAssistantMessage(fauxToolCall("powershell", { command }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(30).fill(route)); supervisor.approve(first.id);
		await vi.waitFor(() => expect(supervisor.store.view(first).assistantMessages?.some(message => message.text === "后台运行中，本轮结束。")).toBe(true), { timeout: 10000 });
		supervisor.approve(second.id); expect(supervisor.board().active).toBe(1); expect(second.queue?.reason).toBe("capacity"); expect(secondStarted).toBe(false);
		expect(supervisor.store.view(first).status).toBe("running"); expect(first.inputs).toEqual([]);
		supervisor.store.steer(first.id, [], "STEER_DURING_JOB"); supervisor.workers.deliver(first.id, "STEER_DURING_JOB", first.inputs.at(-1)?.id);
		await vi.waitFor(() => expect(steers).toBe(1)); expect(first.inputs.at(-1)?.deliveredAt).toBeDefined(); expect(secondStarted).toBe(false); expect(supervisor.board().active).toBe(1);
		writeFileSync(gate, '{"exitCode":0}');
		await vi.waitFor(() => expect(second.ended?.outcome).toBe("done"), { timeout: 15000 });
		expect(first.ended?.outcome).toBe("done"); expect(first.runs).toHaveLength(1); expect(commands).toBe(1); expect(completions).toBe(1);
		expect(first.inputs.filter(input => input.kind === "nudge")).toEqual([]); expect(first.inputs.filter(input => input.kind === "job_done" && input.deliveredAt)).toHaveLength(1);
		expect(supervisor.store.access(first.id)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "job", target: "J-1" })]));
	}, 25000);

	it("steers job completion into a busy worker without opening another session or exceeding capacity", async () => {
		const { harness, supervisor, task, gate, command } = await setup(); const item = task("BUSY_JOB");
		let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); let busy = false; let completion = false;
		const route: FauxResponseStep = async (context, options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("结果收到。");
			const user = getMessageText(context.messages.findLast(message => message.role === "user"));
			const tool = context.messages.findLast(message => message.role === "toolResult");
			if (tool?.role === "toolResult" && tool.toolName === "task_report") return fauxAssistantMessage("完成。");
			if (user.includes("<rally-job")) { completion = true; return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "busy completion received" }), { stopReason: "toolUse" }); }
			if (tool?.role === "toolResult") {
				busy = true; options?.signal?.addEventListener("abort", release, { once: true }); await hold;
				return fauxAssistantMessage("当前工作步骤完成。");
			}
			return fauxAssistantMessage(fauxToolCall("powershell", { command }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(20).fill(route)); supervisor.approve(item.id);
		try {
			await vi.waitFor(() => expect(busy).toBe(true), { timeout: 10000 }); writeFileSync(gate, '{"exitCode":0}');
			await vi.waitFor(() => expect(item.inputs.find(input => input.kind === "job_done")?.deliveredAt).toBeDefined(), { timeout: 10000 });
			expect(completion).toBe(false); expect(supervisor.board().active).toBe(1); release();
			await vi.waitFor(() => expect(item.ended?.outcome).toBe("done"), { timeout: 10000 }); expect(completion).toBe(true); expect(item.runs).toHaveLength(1);
		} finally { release(); }
	}, 25000);

	it("returns the actual killedJobs count from main cancellation and never sends job_done after termination", async () => {
		const { harness, supervisor, task, command } = await setup(); const item = task("CANCEL_JOBS"); let killedJobs: number | undefined;
		const route: FauxResponseStep = (context, _options, _state, model) => {
			const tool = context.messages.findLast(message => message.role === "toolResult");
			if (model.id === "main") {
				if (tool?.role === "toolResult" && tool.toolName === "task_cancel") { killedJobs = JSON.parse(getMessageText(tool)).killedJobs; return fauxAssistantMessage("已取消后台作业。"); }
				const user = context.messages.filter(message => message.role === "user").map(getMessageText).join("\n");
				const id = [...user.matchAll(/User message (#\d+)/g)].at(-1)?.[1];
				expect(id, user).toBeDefined();
				if (!id) throw new Error("Missing fixture user message reference");
				return fauxAssistantMessage(fauxToolCall("task_cancel", { taskId: item.id, quotes: [{ id }] }), { stopReason: "toolUse" });
			}
			if (tool?.role === "toolResult") return fauxAssistantMessage("两个作业运行中。");
			return fauxAssistantMessage([fauxToolCall("powershell", { command }), fauxToolCall("powershell", { command })], { stopReason: "toolUse" });
		};
		harness.setResponses(Array(20).fill(route)); supervisor.approve(item.id);
		await vi.waitFor(() => expect(item.jobs?.filter(job => job.backgroundedAt)).toHaveLength(2), { timeout: 10000 });
		await vi.waitFor(() => expect(item.jobs?.every(job => supervisor.jobs.output(item.id, job.id).output.includes("READY"))).toBe(true), { timeout: 10000 });
		await supervisor.main.send(`取消任务 ${item.id} 及其作业。`);
		await vi.waitFor(() => expect(killedJobs, JSON.stringify({ jobs: item.jobs, main: supervisor.main.state().messages })).toBe(2), { timeout: 15000 });
		expect(item.ended?.outcome).toBe("cancelled"); expect(item.jobs?.every(job => job.status === "killed")).toBe(true); expect(item.inputs.filter(input => input.kind === "job_done")).toEqual([]);
		expect(JSON.parse(readFileSync(supervisor.processes.file, "utf8")).processes).toEqual([]);
	}, 25000);

	it("kills a running job on a terminal worker report without waking it again", async () => {
		const { harness, supervisor, task, command } = await setup(); const item = task("READY_KILLS_JOB");
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("收到。");
			const tool = context.messages.findLast(message => message.role === "toolResult");
			if (tool?.role === "toolResult" && tool.toolName === "task_report") return fauxAssistantMessage("完成。");
			if (tool?.role === "toolResult") return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "no longer need job" }), { stopReason: "toolUse" });
			return fauxAssistantMessage(fauxToolCall("powershell", { command }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(12).fill(route)); supervisor.approve(item.id);
		await vi.waitFor(() => expect(item.jobs?.[0].status).toBe("killed"), { timeout: 10000 }); expect(item.ended?.outcome).toBe("done"); expect(item.inputs).toEqual([]);
	}, 15000);
});
