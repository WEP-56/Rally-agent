import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { stopProcessTree } from "../../../../src/main/supervisor/process-identity.ts";
import type { OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("Rally services in production sessions (faux provider)", () => {
	const harnesses: Harness[] = []; const supervisors: Supervisor[] = [];
	afterEach(async () => { await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose())); vi.unstubAllEnvs(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup(readyMs = 8000) {
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness({ provider: "rally-service-test", models: [{ id: "main" }, { id: "worker" }] }); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, limit: 1, serviceReadyMs: readyMs, serviceStopGraceMs: 50 }); supervisors.push(supervisor);
		await supervisor.models.save([{ id: "rally-service-test", name: "Offline services", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady(); if (!runtime) throw new Error("missing runtime");
		runtime.registerProvider("rally-service-test", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-service-test", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "rally-service-test", model: "worker", thinkingLevel: "off" }); await supervisor.start();
		const task = (title: string) => supervisor.store.create({ title, cwd: paths.workspaceDir, mode: "write", scope: [], dependsOn: [], autoApprove: false, quotes: [{ messageId: "#fixture", kind: "user", text: "run fixture", at: Date.now() }] }).task;
		const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
		const command = `& ${quote(process.execPath)} ${quote(fileURLToPath(new URL("../fixtures/rally-service.cjs", import.meta.url)))}`;
		return { harness, paths, supervisor, task, command };
	}

	it("retains a service after ready, frees the slot, exposes service facts and allows user stop without a worker", async () => {
		const { harness, supervisor, task, command } = await setup(); const first = task("FIRST_SERVICE"); const second = task("NEXT_TASK"); let secondStarted = false; let mainServiceState = false;
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") { mainServiceState ||= context.messages.some(message => getMessageText(message).includes('"name":"preview"')); return fauxAssistantMessage("收到。"); }
			const user = getMessageText(context.messages.findLast(message => message.role === "user"));
			const tool = context.messages.findLast(message => message.role === "toolResult");
			if (tool?.role === "toolResult" && tool.toolName === "task_report") return fauxAssistantMessage("完成。");
			if (user.includes("NEXT_TASK")) { secondStarted = true; return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "next done" }), { stopReason: "toolUse" }); }
			if (tool?.role === "toolResult" && tool.toolName === "service_start") { expect(getMessageText(tool)).toContain('"ready":true'); return fauxAssistantMessage(fauxToolCall("task_read", { view: "services" }), { stopReason: "toolUse" }); }
			if (tool?.role === "toolResult" && tool.toolName === "task_read") { expect(getMessageText(tool)).toContain('"name":"preview"'); return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "preview available" }), { stopReason: "toolUse" }); }
			expect(getCurrentTools(context.messages).map(tool => tool.name)).toEqual(expect.arrayContaining(["service_start", "service_stop", "service_status"]));
			return fauxAssistantMessage(fauxToolCall("service_start", { name: "preview", command }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(30).fill(route)); supervisor.approve(first.id); supervisor.approve(second.id);
		await vi.waitFor(() => expect(second.ended?.outcome).toBe("done"), { timeout: 15000 });
		expect(first.ended?.outcome).toBe("done"); expect(secondStarted).toBe(true); expect(supervisor.services.state().services[0]).toMatchObject({ status: "running", taskId: first.id });
		await vi.waitFor(() => expect(supervisor.board().active).toBe(0)); expect(first.inputs).toEqual([]);
		expect(supervisor.store.access(first.id)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "service", target: "S-1" })]));
		await supervisor.main.send("列出当前本地服务"); await vi.waitFor(() => expect(mainServiceState).toBe(true));
		await supervisor.services.stop("S-1", "user"); expect(first.ended?.outcome).toBe("done"); expect(first.runs).toHaveLength(1); expect(first.inputs).toEqual([]);
		expect(supervisor.main.state().messages.some(message => message.text.includes("已停止本地服务 preview"))).toBe(true);
	}, 25000);

	it("cancels a worker during readiness wait without stopping its established service", async () => {
		const { harness, supervisor, task, command } = await setup(30000); const item = task("CANCEL_SERVICE_WAIT");
		const route: FauxResponseStep = (_context, _options, _state, model) => model.id === "main" ? fauxAssistantMessage("收到。") : fauxAssistantMessage(fauxToolCall("service_start", { name: "silent", command: `${command} silent` }), { stopReason: "toolUse" });
		harness.setResponses(Array(10).fill(route)); supervisor.approve(item.id);
		await vi.waitFor(() => expect(item.services?.[0]?.pid).toBeDefined(), { timeout: 10000 });
		supervisor.cancel(item.id); await supervisor.workers.abort(item.id);
		expect(item.ended?.outcome).toBe("cancelled"); expect(item.services?.[0].status).toBe("running"); expect(item.inputs).toEqual([]);
		await supervisor.services.stop("S-1", "user"); expect(item.services?.[0].status).toBe("stopped");
	}, 20000);

	it("lets a resumed worker stop and replace a service created by its previous run", async () => {
		const { harness, supervisor, task, command } = await setup(); const item = task("RESUMABLE_SERVICE"); let resumed = false; let step = 0;
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("收到。");
			const tool = context.messages.findLast(message => message.role === "toolResult");
			if (resumed) {
				step++;
				if (step === 1) return fauxAssistantMessage(fauxToolCall("service_status", { serviceId: "S-1" }), { stopReason: "toolUse" });
				if (step === 2) { expect(getMessageText(tool)).toContain('"status":"running"'); return fauxAssistantMessage(fauxToolCall("service_stop", { serviceId: "S-1" }), { stopReason: "toolUse" }); }
				if (step === 3) return fauxAssistantMessage(fauxToolCall("service_start", { name: "replacement", command }), { stopReason: "toolUse" });
				if (step === 4) return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "restarted" }), { stopReason: "toolUse" });
				return fauxAssistantMessage("完成。");
			}
			if (tool?.role === "toolResult" && tool.toolName === "task_report") return fauxAssistantMessage("完成。");
			if (tool?.role === "toolResult") return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "service ready" }), { stopReason: "toolUse" });
			return fauxAssistantMessage(fauxToolCall("service_start", { name: "original", command }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(30).fill(route)); supervisor.approve(item.id);
		await vi.waitFor(() => expect(item.ended?.outcome).toBe("done"), { timeout: 12000 }); await supervisor.workers.abort(item.id);
		resumed = true; supervisor.store.resume(item.id, { quotes: [{ messageId: "#resume", kind: "user", text: "restart service", at: Date.now() }] }); supervisor.approve(item.id);
		await vi.waitFor(() => expect(item.runs).toHaveLength(2), { timeout: 10000 });
		await vi.waitFor(() => expect(item.ended?.outcome).toBe("done"), { timeout: 12000 });
		expect(item.services?.map(service => ({ id: service.id, status: service.status, runId: service.runId }))).toEqual([
			{ id: "S-1", status: "stopped", runId: item.runs[0].id }, { id: "S-2", status: "running", runId: item.runs[1].id },
		]);
	}, 30000);

	it("recovers a crashed owner's real HTTP service before restoring task state, without restarting or waking it", async () => {
		const harness = await createHarness(); harnesses.push(harness); const paths = resolveRallyPaths(harness.tempDir);
		const env = { ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" };
		const owner = spawn(process.execPath, [fileURLToPath(new URL("../fixtures/rally-service-owner.ts", import.meta.url)), harness.tempDir], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
		let diagnostics = ""; owner.stderr?.on("data", chunk => { diagnostics += chunk; });
		let entries: OwnedProcess[] = []; let recovered: Supervisor | undefined;
		try {
			const message = (await Promise.race([once(owner, "message"), once(owner, "exit").then(() => { throw new Error(diagnostics || "Service owner exited before ready"); })]))[0] as { taskId: string; result: { serviceId: string; url: string } };
			expect(await (await fetch(message.result.url)).text()).toBe("真实服务 ✓");
			entries = JSON.parse(readFileSync(join(paths.stateDir, "processes.json"), "utf8")).processes; expect(entries[0]).toMatchObject({ kind: "service", serviceId: "S-1" });
			const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
			expect((await fetch(message.result.url)).status).toBe(200);
			recovered = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); await recovered.start();
			await expect(fetch(message.result.url)).rejects.toThrow();
			expect(recovered.services.state().services[0]).toMatchObject({ status: "stopped", ready: false, reason: "interrupted" });
			expect(recovered.store.get(message.taskId)?.inputs).toEqual([]); expect(recovered.services.status(message.taskId, "S-1").output).toContain("PID");
		} finally {
			if (owner.exitCode === null && owner.signalCode === null) { const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited; }
			const registry = join(paths.stateDir, "processes.json"); if (!entries.length && existsSync(registry)) entries = JSON.parse(readFileSync(registry, "utf8")).processes;
			for (const entry of entries) await stopProcessTree(entry, 0); await recovered?.dispose();
		}
	}, 25000);
});
