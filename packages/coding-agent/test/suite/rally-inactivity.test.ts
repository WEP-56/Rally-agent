import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ExternalWorkerSession } from "../../../../src/main/supervisor/external-worker-session.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { INACTIVITY_TIMEOUT, InactivityProtection } from "../../../../src/main/supervisor/inactivity.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import type { Task } from "../../../../src/shared/task.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("durable inactivity protection", () => {
	const cleanups: (() => Promise<void>)[] = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	}, 30000);

	it("uses the last historical user message across resets, ignores presence, and stays paused after a clock rollback", async () => {
		const directory = mkdtempSync(join(tmpdir(), "rally-idle-"));
		const events = new EventLog(join(directory, "events.jsonl"));
		let now = 1000;
		events.append("chat_message", { n: 1, role: "user", at: now, text: "hello" });
		events.append("chat_reset", {});
		events.append("user_seen", {});
		const pause = vi.fn(async () => {});
		let protection = new InactivityProtection(events, { now: () => now, pause, changed: () => {} });
		cleanups.push(async () => { await protection.dispose(); events.close(); rmSync(directory, { recursive: true, force: true }); });
		await protection.start();
		now += INACTIVITY_TIMEOUT - 1;
		expect(protection.canRun()).toBe(true);
		now++;
		expect(protection.canRun()).toBe(false);
		await protection.dispose();
		expect(pause).toHaveBeenCalledTimes(1);
		now = 1000;
		protection = new InactivityProtection(events, { now: () => now, pause, changed: () => {} });
		await protection.start();
		expect(protection.canRun()).toBe(false);
		await protection.userMessage();
		expect(protection.canRun()).toBe(true);
		expect(protection.state()).toEqual({ lastUserAt: now, pausedAt: undefined });
	});

	it("persists the initial deadline and waits for cleanup before accepting a wake", async () => {
		const directory = mkdtempSync(join(tmpdir(), "rally-idle-"));
		const events = new EventLog(join(directory, "events.jsonl"));
		let now = 1000;
		const cleanup = Promise.withResolvers<void>();
		let protection = new InactivityProtection(events, { now: () => now, pause: () => cleanup.promise, changed: () => {} });
		cleanups.push(async () => { cleanup.resolve(); await protection.dispose(); events.close(); rmSync(directory, { recursive: true, force: true }); });
		await protection.start();
		await protection.dispose();
		now += INACTIVITY_TIMEOUT;
		protection = new InactivityProtection(events, { now: () => now, pause: () => cleanup.promise, changed: () => {} });
		const started = protection.start();
		const wake = protection.userMessage();
		await Promise.resolve();
		expect(protection.canRun()).toBe(false);
		cleanup.resolve();
		await started;
		await wake;
		expect(protection.canRun()).toBe(true);
	});

	async function setup() {
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness({ provider: "idle-test", models: [{ id: "main" }, { id: "worker" }, { id: "coach" }] });
		const paths = resolveRallyPaths(join(harness.tempDir, "home"));
		ensureRallyDirs(paths);
		let now = Date.now();
		const supervisors: Supervisor[] = [];
		cleanups.push(async () => {
			for (const supervisor of supervisors) await supervisor.dispose();
			harness.cleanup();
		});
		const reopen = async () => {
			const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, inactivityNow: () => now, coachNow: () => now, coachRandom: () => 0, jobForegroundSeconds: 0.05, jobStopGraceMs: 30, serviceStopGraceMs: 30 });
			supervisors.push(supervisor);
			await supervisor.models.save([{ id: "idle-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux", models: harness.models.map(model => defaultModel(model.id)) }]);
			const runtime = (await supervisor.models.whenReady())!;
			runtime.registerProvider("idle-test", { api: harness.faux.api, apiKey: "faux", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
			supervisor.models.setActive({ provider: "idle-test", model: "main", thinkingLevel: "off" });
			await supervisor.models.selectWorker({ provider: "idle-test", model: "worker", thinkingLevel: "off" });
			await supervisor.start();
			return supervisor;
		};
		const supervisor = await reopen();
		return { supervisor, harness, paths, reopen, advance: (milliseconds: number) => { now += milliseconds; }, now: () => now };
	}

	async function hello(supervisor: Supervisor, harness: Harness) {
		harness.setResponses([fauxAssistantMessage("hello back")]);
		await supervisor.main.send("hello");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some(line => line.text === "hello back" && !line.streaming) && !supervisor.main.isBusy()).toBe(true));
	}

	function task(supervisor: Supervisor, title: string): Task {
		return supervisor.store.create({ title, cwd: supervisor.paths.workspaceDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: false,
			quotes: [{ messageId: "#fixture", kind: "user", text: title, at: Date.now() }] }).task;
	}

	it("blocks schedules, queued workers, relay turns, coach and compaction until a real message, including across restart", async () => {
		const { supervisor, harness, paths, advance, now, reopen } = await setup();
		await hello(supervisor, harness);
		const quote = supervisor.main.quote({ id: supervisor.main.state().messages.find(line => line.role === "user")!.id })!;
		const plan = supervisor.schedules.create({ title: "interval", cwd: paths.workspaceDir, mode: "readonly", timing: { kind: "interval", minutes: 60 } }, [quote]);
		const disabled = supervisor.schedules.create({ title: "disabled", cwd: paths.workspaceDir, mode: "readonly", timing: { kind: "interval", minutes: 120 } }, [quote]);
		supervisor.schedules.update(disabled.id, false);
		advance(INACTIVITY_TIMEOUT);
		expect(supervisor.inactivity.canRun()).toBe(false);
		await vi.waitFor(() => expect(supervisor.main.canReceiveRelay()).toBe(false));
		supervisor.userSeen();
		await supervisor.main.send("  ");
		supervisor.relay.idea(id => `<rally-idea id="${id}">background only</rally-idea>`);
		supervisor.schedules.poll();
		const queued = task(supervisor, "queued");
		supervisor.approve(queued.id);
		supervisor.coachSettings.update({ enabled: true, model: { provider: "idle-test", model: "coach", thinkingLevel: "off" } });
		await supervisor.coach.tick();
		expect(supervisor.events.ofKind("coach_run")).toHaveLength(0);
		expect(await supervisor.main.reset()).toBe(false);
		expect(queued.runs).toHaveLength(0);
		expect(supervisor.schedules.list().find(item => item.id === plan.id)?.lastTaskId).toBeUndefined();
		await supervisor.dispose();
		const restored = await reopen();
		expect(restored.main.state().inactivity?.pausedAt).toBe(now());
		expect(restored.store.get(queued.id)?.runs).toHaveLength(0);
		harness.setResponses(Array(25).fill(((_context, _options, _state, model) => model.id === "worker"
			? fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "finished" }), { stopReason: "toolUse" })
			: fauxAssistantMessage("welcome back")) satisfies FauxResponseStep));
		await restored.main.send("I'm back");
		await vi.waitFor(() => expect(restored.store.get(queued.id)?.ended?.outcome).toBe("done"));
		restored.schedules.poll();
		expect(restored.store.list().filter(item => item.schedule?.id === plan.id)).toHaveLength(1);
		expect(restored.schedules.list().find(item => item.id === disabled.id)?.enabled).toBe(false);
		expect(restored.inactivity.state().pausedAt).toBeUndefined();
	});

	it("aborts an in-flight worker and resumes the same run with recovery instructions", async () => {
		const { supervisor, harness, advance } = await setup();
		await hello(supervisor, harness);
		const working = task(supervisor, "working");
		let started = false;
		let aborted = false;
		harness.setResponses([async (_context, options) => {
			started = true;
			await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
			return fauxAssistantMessage("interrupted response");
		}]);
		supervisor.approve(working.id);
		await vi.waitFor(() => expect(started).toBe(true));
		advance(INACTIVITY_TIMEOUT);
		supervisor.inactivity.check();
		await vi.waitFor(() => expect(aborted && !supervisor.workers.has(working.id)).toBe(true));
		expect(working.ended).toBeUndefined();
		expect(working.runs[0].inactivityPausedAt).toBeDefined();
		let recovered = false;
		const recoveredResponse: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("welcome back");
			recovered = context.messages.some(message => getMessageText(message).includes("Check current files and external results before retrying"));
			return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "finished once" }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(20).fill(recoveredResponse));
		await supervisor.main.send("back");
		await vi.waitFor(() => expect(working.ended?.outcome).toBe("done"));
		expect(recovered).toBe(true);
		expect(working.runs).toHaveLength(1);
		expect(working.runs[0].inactivityPausedAt).toBeUndefined();
	});

	it("blocks a tool returned across the deadline before it can dispatch more work", async () => {
		const { supervisor, harness, paths, advance } = await setup();
		let calls = 0;
		harness.setResponses([context => {
			calls++;
			const quoteId = /User message (#\d+)/.exec(getMessageText(context.messages.findLast(message => message.role === "user")))![1];
			advance(INACTIVITY_TIMEOUT);
			return fauxAssistantMessage(fauxToolCall("task_dispatch", { title: "must not start", cwd: paths.workspaceDir, mode: "readonly", quotes: [{ id: quoteId }] }), { stopReason: "toolUse" });
		}]);
		await supervisor.main.send("do some work");
		await vi.waitFor(() => expect(supervisor.inactivity.state().pausedAt).toBeDefined());
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		expect(calls).toBe(1);
		expect(supervisor.store.list()).toHaveLength(0);
		await hello(supervisor, harness);
		expect(supervisor.inactivity.canRun()).toBe(true);
	});

	it("interrupts an active coach and does not restart it while paused", async () => {
		const { supervisor, harness, advance } = await setup();
		await hello(supervisor, harness);
		supervisor.coachSettings.update({ enabled: true, ideasPerDay: 0, model: { provider: "idle-test", model: "coach", thinkingLevel: "off" } });
		advance(24 * 60 * 60 * 1000);
		let started = false;
		let aborted = false;
		harness.setResponses([async (_context, options) => {
			started = true;
			await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
			return fauxAssistantMessage("not completed");
		}]);
		const running = supervisor.coach.tick();
		await vi.waitFor(() => expect(started).toBe(true));
		advance(48 * 60 * 60 * 1000);
		supervisor.inactivity.check();
		await running;
		expect(aborted).toBe(true);
		const attempts = supervisor.events.ofKind("coach_run").length;
		await supervisor.coach.tick();
		expect(supervisor.events.ofKind("coach_run")).toHaveLength(attempts);
		expect(supervisor.events.ofKind("idea_raised")).toHaveLength(0);
	});

	it("stops background jobs and services, including services owned by completed tasks", async () => {
		const { supervisor, harness, paths, advance } = await setup();
		await hello(supervisor, harness);
		const running = task(supervisor, "job owner");
		const run = supervisor.store.startRun(running.id, "dispatch", "fixture");
		const jobCommand = { executable: process.execPath, args: [fileURLToPath(new URL("../fixtures/rally-job.cjs", import.meta.url)), join(paths.home, "job-release")], cwd: paths.workspaceDir, env: process.env };
		await supervisor.jobs.execute(running, run, "bash", "offline job fixture", jobCommand);
		const serviceTask = task(supervisor, "service owner");
		const serviceRun = supervisor.store.startRun(serviceTask.id, "dispatch", "fixture");
		const serviceCommand = { executable: process.execPath, args: [fileURLToPath(new URL("../fixtures/rally-service.cjs", import.meta.url)), "pattern", join(paths.home, "service-release")], cwd: paths.workspaceDir, env: process.env };
		await supervisor.services.start(serviceTask, serviceRun, { name: "fixture", command: "offline service fixture", readyPattern: "APP_READY" }, undefined, serviceCommand);
		supervisor.store.report(serviceTask.id, serviceRun.id, "ready", "service retained");
		expect(supervisor.services.state().services[0].status).toBe("running");
		advance(INACTIVITY_TIMEOUT);
		supervisor.inactivity.check();
		await vi.waitFor(() => {
			expect(running.jobs?.[0]).toMatchObject({ status: "killed", reason: "inactivity" });
			expect(supervisor.services.state().services[0]).toMatchObject({ status: "stopped", reason: "inactivity" });
			expect(JSON.parse(readFileSync(supervisor.processes.file, "utf8")).processes).toHaveLength(0);
		}, { timeout: 15000 });
		expect(running.ended).toBeUndefined();
		expect(serviceTask.ended?.outcome).toBe("done");
		await hello(supervisor, harness);
		expect(supervisor.services.state().services[0].status).toBe("stopped");
	}, 25000);

	it("keeps pending questions valid and accepts new IM messages or direct task answers as a wake", async () => {
		const { supervisor, harness, advance, now } = await setup();
		const source = { platform: "feishu" as const, appId: "app", chatId: "chat", messageId: "first" };
		harness.setResponses([fauxAssistantMessage("IM received")]);
		expect(await supervisor.main.sendFromIm("hello IM", source)).toBe("IM received");
		const waiting = task(supervisor, "waiting");
		harness.setResponses([fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "need answer", question: "Which one?", options: ["A", "B"] }), { stopReason: "toolUse" }), fauxAssistantMessage("waiting")]);
		supervisor.approve(waiting.id);
		await vi.waitFor(() => expect(waiting.attention?.id).toBeDefined());
		const questionId = waiting.attention!.id;
		supervisor.store.escalateAttention(waiting.id, questionId);
		advance(INACTIVITY_TIMEOUT);
		supervisor.inactivity.check();
		await vi.waitFor(() => expect(supervisor.workers.has(waiting.id)).toBe(false));
		expect(await supervisor.main.sendFromIm("duplicate", source)).toBeNull();
		expect(supervisor.inactivity.canRun()).toBe(false);
		expect(waiting.attention?.id).toBe(questionId);
		harness.setResponses([fauxAssistantMessage("back via IM")]);
		expect(await supervisor.main.sendFromIm("back", { ...source, messageId: "second" })).toBe("back via IM");
		expect(waiting.runs).toHaveLength(1);
		expect(waiting.attention?.id).toBe(questionId);
		expect(supervisor.inactivity.state().lastUserAt).toBe(now());
		const messagesBeforeResume = supervisor.store.assistantMessages(waiting.id);
		expect(messagesBeforeResume.length).toBeGreaterThan(0);
		advance(INACTIVITY_TIMEOUT);
		supervisor.inactivity.check();
		expect(supervisor.inactivity.canRun()).toBe(false);
		harness.setResponses(Array(20).fill(((_context, _options, _state, model) => model.id === "worker"
			? fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "answered" }), { stopReason: "toolUse" })
			: fauxAssistantMessage("ack")) satisfies FauxResponseStep));
		supervisor.answerOption(waiting.id, questionId, "A");
		await vi.waitFor(() => expect(waiting.ended?.outcome).toBe("done"));
		expect(supervisor.inactivity.canRun()).toBe(true);
		expect(supervisor.inactivity.state().lastUserAt).toBe(now());
		const messagesAfterResume = supervisor.store.assistantMessages(waiting.id);
		for (const message of messagesBeforeResume) expect(messagesAfterResume.find(item => item.id === message.id)?.text).toBe(message.text);
		expect(messagesAfterResume.length).toBeGreaterThan(messagesBeforeResume.length);
	});

	it.each(["claude-code", "codex"] as const)("closes an active %s session and preserves its tool history on resume", async executor => {
		const { supervisor, harness, paths, advance } = await setup();
		await hello(supervisor, harness);
		const role = supervisor.roleWorkers.save({ id: "external", name: "External", avatar: null, summary: "fixture", personality: "", workstyle: "", recommendedSkills: [], executor, externalModel: "fixture" }, () => false, () => true)[0];
		const interrupted = Promise.withResolvers<string>();
		const closed = vi.fn(async () => { interrupted.resolve("cancelled"); });
		let generation = 0;
		const start = vi.spyOn(ExternalWorkerSession, "start").mockImplementation(async options => {
			const current = ++generation;
			const prompt: ExternalWorkerSession["prompt"] = async content => {
				options.onTool?.({ id: "call-1", name: "Read", status: "running" });
				options.onText?.(current === 1 ? "Before pause" : "After resume");
				if (current === 1) return interrupted.promise;
				expect(JSON.stringify(content)).toContain("Check current files and external results before retrying");
				options.onTool?.({ id: "call-1", status: "ok", output: "new result" });
				options.onText?.("\nRALLY_STATUS: ready\nFinished");
				return "end_turn";
			};
			return Object.assign(Object.create(ExternalWorkerSession.prototype) as ExternalWorkerSession, { prompt, close: closed });
		});
		const working = supervisor.store.create({ title: "external", cwd: paths.workspaceDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: false, roleId: role.id,
			quotes: [{ messageId: "#fixture", kind: "user", text: "inspect files", at: Date.now() }] }).task;
		supervisor.approve(working.id);
		await vi.waitFor(() => expect(supervisor.store.timeline(working.id)).toHaveLength(1));
		advance(INACTIVITY_TIMEOUT);
		supervisor.inactivity.check();
		await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
		expect(working.ended).toBeUndefined();
		await hello(supervisor, harness);
		await vi.waitFor(() => expect(working.ended?.outcome).toBe("done"));
		expect(start).toHaveBeenCalledTimes(2);
		expect(working.runs).toHaveLength(1);
		expect(supervisor.store.timeline(working.id).map(call => call.status)).toEqual(["interrupted", "ok"]);
		expect(supervisor.store.assistantMessages(working.id).map(message => message.text)).toEqual(["Before pause", "After resume\nRALLY_STATUS: ready\nFinished"]);
	});
});
