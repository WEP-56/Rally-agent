import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { DefaultResourceLoader } from "../../src/index.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const TEN_MINUTES = 600000;
const complete = () => fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "recovered" }), { stopReason: "toolUse" });
describe("Rally inactivity watchdog with production sessions and faux provider", () => {
	const harnesses: Harness[] = []; const supervisors: Supervisor[] = []; const releaseAll: Array<() => void> = [];
	afterEach(async () => { for (const release of releaseAll.splice(0)) release(); await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose())); vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup(limit = 2, foregroundSeconds = 0.03) {
		vi.stubEnv("PI_OFFLINE", "1"); const harness = await createHarness({ provider: "rally-watchdog", models: [{ id: "main" }, { id: "worker" }, { id: "next" }] }); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths); const clock = { now: 0 };
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, limit, watchdogNow: () => clock.now, jobForegroundSeconds: foregroundSeconds, jobStopGraceMs: 50, serviceReadyMs: 8000, serviceStopGraceMs: 50 }); supervisors.push(supervisor);
		await supervisor.models.save([{ id: "rally-watchdog", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady(); if (!runtime) throw new Error("missing runtime"); runtime.registerProvider("rally-watchdog", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-watchdog", model: "main", thinkingLevel: "off" }); await supervisor.models.selectWorker({ provider: "rally-watchdog", model: "worker", thinkingLevel: "off" }); await supervisor.start();
		const task = supervisor.store.create({ title: "Watchdog fixture", cwd: paths.workspaceDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: false, quotes: [] }).task;
		const tick = (delta: number) => { clock.now += delta; supervisor.workers.checkStalled(); };
		return { harness, paths, supervisor, clock, task, tick };
	}
	function hold(signal?: AbortSignal, respectAbort = true) { return new Promise<void>(resolve => { releaseAll.push(resolve); if (respectAbort) { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); } }); }
	it("retries after ten idle minutes in the same run, session and pinned model", async () => {
		const { harness, paths, supervisor, task, tick } = await setup(); let calls = 0; let retryText = "";
		const route: FauxResponseStep = async (context, options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("已收到。");
			calls++; if (calls === 1) { await hold(options?.signal); return fauxAssistantMessage("aborted"); }
			if (calls === 2) { expect(model.id).toBe("worker"); retryText = getMessageText(context.messages.findLast(message => message.role === "user")); return complete(); }
			return fauxAssistantMessage("完成。");
		}; harness.setResponses(Array(15).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(1));
		await supervisor.models.selectWorker({ provider: "rally-watchdog", model: "next", thinkingLevel: "off" });
		tick(TEN_MINUTES - 1); expect(task.runs[0].stallRetries).toBeUndefined(); tick(1);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done")); expect(task.runs).toHaveLength(1); expect(task.runs[0].stallRetries).toBe(1); expect(retryText).toContain("No activity for 10 minutes");
		expect(supervisor.events.ofKind("run_stall_retry")).toHaveLength(1); expect(readFileSync(join(paths.sessionsTasksDir, `${task.id}.jsonl`), "utf8")).toContain("Continue the task from where it stopped");
	});
	it("fails a second silent turn as stalled and wakes main exactly once", async () => {
		const { harness, supervisor, task, tick } = await setup(); let calls = 0; let main = 0;
		const route: FauxResponseStep = async (_context, options, _state, model) => { if (model.id === "main") { main++; return fauxAssistantMessage("处理卡死。"); } calls++; await hold(options?.signal); return fauxAssistantMessage("aborted"); };
		harness.setResponses(Array(12).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(1)); tick(TEN_MINUTES); await vi.waitFor(() => expect(calls).toBe(2));
		tick(TEN_MINUTES); await vi.waitFor(() => expect(task.ended?.outcome).toBe("failed")); expect(task.ended?.by).toBe("system"); expect(task.runs[0].endReason).toBe("stalled"); await vi.waitFor(() => expect(main).toBe(1), { timeout: 5000 });
		tick(TEN_MINUTES); expect(supervisor.events.ofKind("task_report").filter(event => event.data.source === "watchdog")).toHaveLength(1); expect(calls).toBe(2);
	});
	it("resets the deadline on actual tool/model activity rather than total run time", async () => {
		const { harness, supervisor, task, clock, tick, paths } = await setup(); let calls = 0; let first!: () => void; const gate = new Promise<void>(resolve => { first = resolve; releaseAll.push(resolve); }); writeFileSync(join(paths.workspaceDir, "note.txt"), "activity");
		const route: FauxResponseStep = async (_context, options, _state, model) => { if (model.id === "main") return fauxAssistantMessage("OK"); calls++; if (calls === 1) { await gate; return fauxAssistantMessage(fauxToolCall("read", { path: "note.txt" }), { stopReason: "toolUse" }); } if (calls === 2) { await hold(options?.signal); return fauxAssistantMessage("aborted"); } return calls === 3 ? complete() : fauxAssistantMessage("done"); };
		harness.setResponses(Array(15).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(1)); clock.now = 500000; first(); await vi.waitFor(() => expect(calls).toBe(2));
		tick(100000); expect(task.runs[0].stallRetries).toBeUndefined(); tick(500000); await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
	});
	it("does not retry idle blocked workers or pending approvals", async () => {
		const { harness, supervisor, task, tick } = await setup(); let calls = 0;
		harness.setResponses(Array(10).fill((_context: unknown, _options: unknown, _state: unknown, model: { id: string }) => { if (model.id === "main") return fauxAssistantMessage("OK"); return ++calls === 1 ? fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "needs user" }), { stopReason: "toolUse" }) : fauxAssistantMessage("waiting"); }));
		tick(TEN_MINUTES * 2); expect(task.runs).toHaveLength(0); supervisor.approve(task.id); await vi.waitFor(() => expect(supervisor.workers.has(task.id) && supervisor.workers.streamingCount() === 0).toBe(true));
		tick(TEN_MINUTES * 2); expect(task.runs[0].stallRetries).toBeUndefined(); expect(task.ended).toBeUndefined();
	});
	it("never overlaps a retry if abort does not settle, and late completion cannot revive the task", async () => {
		const { harness, supervisor, task, tick } = await setup(); let calls = 0;
		const route: FauxResponseStep = async (_context, options, _state, model) => { if (model.id === "main") return fauxAssistantMessage("OK"); calls++; await hold(options?.signal, false); return complete(); };
		harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(1)); tick(TEN_MINUTES); tick(TEN_MINUTES); expect(task.ended?.outcome).toBe("failed"); expect(task.runs[0].endReason).toBe("stalled"); expect(calls).toBe(1);
		for (const release of releaseAll.splice(0)) release(); await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false)); expect(task.ended?.outcome).toBe("failed");
	});
	it("suspends the clock while a real background job runs and restarts the interval on completion", async () => {
		const { harness, supervisor, task, tick } = await setup(); let calls = 0; const gate = join(harness.tempDir, "job.json");
		const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
		const command = `& ${quote(process.execPath)} ${quote(fileURLToPath(new URL("../fixtures/rally-job.cjs", import.meta.url)))} ${quote(gate)}`;
		const route: FauxResponseStep = async (_context, options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("OK"); calls++;
			if (calls === 1) return fauxAssistantMessage(fauxToolCall("powershell", { command }), { stopReason: "toolUse" });
			if (calls === 2) { await hold(options?.signal); return fauxAssistantMessage("aborted"); } return calls === 3 ? complete() : fauxAssistantMessage("done");
		}; harness.setResponses(Array(20).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(2), { timeout: 10000 });
		tick(TEN_MINUTES * 6); expect(task.runs[0].stallRetries).toBeUndefined(); expect(supervisor.jobs.hasRunning(task.id)).toBe(true);
		writeFileSync(gate, '{"exitCode":0}'); await vi.waitFor(() => expect(supervisor.jobs.hasRunning(task.id)).toBe(false), { timeout: 10000 });
		tick(TEN_MINUTES - 1); expect(task.runs[0].stallRetries).toBeUndefined(); tick(1); await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
	}, 25000);
	it("monitors asynchronous initialization and retries only after the first opening has stopped", async () => {
		const { harness, supervisor, task, tick } = await setup(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; releaseAll.push(resolve); }); let started = false;
		const reload = DefaultResourceLoader.prototype.reload;
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementationOnce(async function (this: DefaultResourceLoader) { started = true; await gate; return reload.call(this); });
		let requests = 0; const route: FauxResponseStep = (_context, _options, _state, model) => { if (model.id === "main") return fauxAssistantMessage("OK"); return ++requests === 1 ? complete() : fauxAssistantMessage("done"); };
		harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(started).toBe(true)); tick(TEN_MINUTES); expect(task.runs[0].stallRetries).toBe(1); expect(requests).toBe(0);
		release(); await vi.waitFor(() => expect(task.ended?.outcome).toBe("done")); expect(task.runs).toHaveLength(1); expect(task.inputs.some(input => input.body?.includes("No activity for 10 minutes"))).toBe(true);
	});
	it("honors cancellation during stalled abort without later retrying", async () => {
		const { harness, supervisor, task, tick } = await setup(); let calls = 0;
		const route: FauxResponseStep = async (_context, options, _state, model) => { if (model.id === "main") return fauxAssistantMessage("OK"); calls++; await hold(options?.signal, false); return complete(); };
		harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(1)); tick(TEN_MINUTES); supervisor.cancel(task.id);
		for (const release of releaseAll.splice(0)) release(); await supervisor.workers.abort(task.id); expect(calls).toBe(1); expect(task.ended?.outcome).toBe("cancelled"); expect(task.inputs.some(input => input.body?.includes("No activity for 10 minutes"))).toBe(false);
	});
	it("fails an unresponsive opening and admits queued work before the old loader returns", async () => {
		const { harness, supervisor, task, tick } = await setup(1); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; releaseAll.push(resolve); }); let loading = false;
		const reload = DefaultResourceLoader.prototype.reload;
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementationOnce(async function (this: DefaultResourceLoader) { loading = true; await gate; return reload.call(this); });
		let requests = 0; const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("OK"); requests++; expect(getMessageText(context.messages.find(message => message.role === "user"))).toContain("next queued task"); return requests === 1 ? complete() : fauxAssistantMessage("done");
		}; harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(loading).toBe(true));
		const next = supervisor.store.create({ title: "next queued task", cwd: task.cwd, mode: "readonly", scope: [], dependsOn: [], autoApprove: false, quotes: [] }).task; supervisor.approve(next.id); expect(next.runs).toHaveLength(0);
		tick(TEN_MINUTES); tick(TEN_MINUTES); expect(task.runs[0].endReason).toBe("stalled"); await vi.waitFor(() => expect(next.ended?.outcome).toBe("done"));
		release(); await supervisor.workers.abort(task.id); expect(task.ended?.outcome).toBe("failed"); expect(task.runs).toHaveLength(1);
	});
	it("does not exempt a stalled worker just because it owns a running service", async () => {
		const { harness, supervisor, task, tick } = await setup(); let calls = 0;
		const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
		const command = `& ${quote(process.execPath)} ${quote(fileURLToPath(new URL("../fixtures/rally-service.cjs", import.meta.url)))}`;
		const route: FauxResponseStep = async (_context, options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("OK"); calls++;
			if (calls === 1) return fauxAssistantMessage(fauxToolCall("service_start", { name: "watchdog preview", command }), { stopReason: "toolUse" });
			if (calls === 2) { await hold(options?.signal); return fauxAssistantMessage("aborted"); } return calls === 3 ? complete() : fauxAssistantMessage("done");
		}; harness.setResponses(Array(15).fill(route)); supervisor.approve(task.id); await vi.waitFor(() => expect(calls).toBe(2), { timeout: 10000 });
		tick(TEN_MINUTES); await vi.waitFor(() => expect(task.ended?.outcome).toBe("done")); expect(task.runs[0].stallRetries).toBe(1); expect(task.services?.[0].status).toBe("running");
	}, 20000);
	it("counts foreground shell output as activity but aborts a silent foreground command", async () => {
		const { harness, supervisor, task, tick, clock } = await setup(2, 3600); let calls = 0; const gate = join(harness.tempDir, "foreground.json");
		const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
		const command = `& ${quote(process.execPath)} ${quote(fileURLToPath(new URL("../fixtures/rally-job.cjs", import.meta.url)))} ${quote(gate)}`;
		const route: FauxResponseStep = (_context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("OK"); calls++;
			return calls === 1 ? fauxAssistantMessage(fauxToolCall("powershell", { command }), { stopReason: "toolUse" }) : calls === 2 ? complete() : fauxAssistantMessage("done");
		}; harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id);
		await vi.waitFor(() => expect(supervisor.jobs.output(task.id, "J-1").output).toContain("READY"), { timeout: 10000 }); expect(supervisor.jobs.hasBackground(task.id)).toBe(false);
		clock.now = 500000; writeFileSync(`${gate}.pulse`, "active"); await vi.waitFor(() => expect(supervisor.jobs.output(task.id, "J-1").output).toContain("PULSE active"));
		tick(100000); expect(task.runs[0].stallRetries).toBeUndefined(); tick(500000); await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"), { timeout: 5000 });
		expect(task.jobs?.[0]).toMatchObject({ status: "killed", reason: "cancelled" }); expect(task.runs[0].stallRetries).toBe(1);
	}, 20000);
});
