import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type FauxResponseStep } from "@rally/ai";
import { expect, it, vi } from "vitest";
import { businessHandlers } from "../../../../src/main/business.ts";
import { cloudCommands } from "../../../../src/main/cloud/commands.ts";
import { cloudVault } from "../../../../src/main/cloud/vault.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { IpcChannel as C } from "../../../../src/shared/ipc.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { CloudMirror } from "../../../../src/shared/cloud-state.ts";
import { createHarness, getMessageText } from "./harness.ts";

it("router requests a private form; saving wakes the idle main agent once with metadata only", async () => {
	const harness = await createHarness({ provider: "rally-credentials", models: [{ id: "main" }] });
	const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
	const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: cloudVault(randomBytes(32)) });
	const username = "UNIQUE-PRIVATE-ACCOUNT", password = "  UNIQUE-PRIVATE-PASSWORD-中文  ";
	const observations: string[] = [];
	try {
		await supervisor.models.save([{ id: "rally-credentials", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady();
		runtime!.registerProvider("rally-credentials", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-credentials", model: "main", thinkingLevel: "off" });
		let requested = false;
		const respond: FauxResponseStep = (context) => {
			observations.push(JSON.stringify(context.messages));
			const names = getCurrentTools(context.messages).map(tool => tool.name);
			expect(names).toContain("credential_request"); expect(names.some(name => name.startsWith("browser_"))).toBe(false);
			if (!requested) { requested = true; return fauxAssistantMessage(fauxToolCall("credential_request", { website: "https://example.test/login" }), { stopReason: "toolUse" }); }
			if (context.messages.some(message => getMessageText(message).includes('kind="credential_result"'))) return fauxAssistantMessage("ACCOUNT_SAVED_RECEIVED");
			return fauxAssistantMessage("请使用账号填写卡片。");
		};
		harness.setResponses(Array(8).fill(respond));
		await supervisor.start(); await supervisor.main.send("请准备网站账号填写卡片。");
		await vi.waitFor(() => { expect(supervisor.websiteAccounts.state().requests).toHaveLength(1); expect(supervisor.main.isBusy()).toBe(false); }, { timeout: 10000 });
		const local = businessHandlers(paths, supervisor, () => {}), cloud = cloudCommands(local);
		const request = cloud[C.credentialsState]().requests[0]; expect(request.status).toBe("pending");
		const state = cloud[C.credentialsSubmit]({ requestId: request.id, website: request.origin, username, password });
		expect(state.requests[0].status).toBe("saved");
		expect(local[C.credentialsSubmit]({ requestId: request.id, website: request.origin, username, password })).toEqual(state);
		await vi.waitFor(() => expect(supervisor.main.state().messages.some(message => message.text === "ACCOUNT_SAVED_RECEIVED")).toBe(true), { timeout: 5000 });
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		expect(supervisor.main.state().messages.filter(message => message.role === "user")).toHaveLength(1);
		const received = observations.filter(text => text.includes(state.accounts[0].id));
		expect(received).toHaveLength(1);
		expect(received[0]).toContain(state.accounts[0].id);
		expect(received[0]).toContain('saved');
		expect(local[C.credentialsCancel](request.id).requests[0].status).toBe("saved");
		expect(supervisor.events.ofKind("relay_enqueued").filter(event => event.data.kind === "credential_result")).toHaveLength(1);
		supervisor.websiteAccounts.request("cancel-only", "https://cancel.test");
		expect(cloud[C.credentialsCancel]("cancel-only").requests.at(-1)?.status).toBe("cancelled");
		await vi.waitFor(() => expect(observations.some(text => text.includes("cancel-only") && text.includes("cancelled"))).toBe(true), { timeout: 5000 });
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		expect(supervisor.websiteAccounts.forHost(state.accounts[0].id, request.origin)).toEqual({ username, password });
		const cache = new CloudMirror("https://server.test", "instance"); cache.remember(C.credentialsState, state);
		expect(cache.read(C.credentialsState)).toBeUndefined();
		for (const output of [...observations, JSON.stringify(state), JSON.stringify(supervisor.main.state()), JSON.stringify(supervisor.events.all()), readFileSync(join(paths.agentDir, "website-accounts.txt"), "utf8"), JSON.stringify(cache.encode())]) {
			expect(output).not.toContain(username); expect(output).not.toContain(password);
		}
		local[C.credentialsUpdate](state.accounts[0].id, false);
		expect(() => supervisor.websiteAccounts.forHost(state.accounts[0].id, request.origin)).toThrow("没有可用");
		cloud[C.credentialsRemove](state.accounts[0].id); expect(local[C.credentialsState]().accounts).toHaveLength(0);
	} finally { await supervisor.dispose(); await harness.cleanup(); }
});

it("a private token is discoverable and usable in CLI and HTTP without reaching model history or logs", async () => {
	const harness = await createHarness({ provider: "rally-token", models: [{ id: "main" }, { id: "worker" }] });
	const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths); mkdirSync(paths.workspaceDir, { recursive: true });
	const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: cloudVault(randomBytes(32)) });
	const token = "gitee-private-fixture-7b68e0f9";
	const observations: string[] = []; let received = "";
	const server = createServer((request, response) => {
		received = request.headers.authorization ?? "";
		response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ authorization: received }));
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); if (!address || typeof address === "string") throw Error("Missing fixture port");
	const script = join(paths.workspaceDir, "verify-token.cjs");
	const hash = createHash("sha256").update(token).digest("hex");
	writeFileSync(script, `const token = process.env.GITEE_TOKEN; if (!token || require('node:crypto').createHash('sha256').update(token).digest('hex') !== '${hash}') process.exit(9); process.stdout.write('TOKEN_OK ' + token.slice(0, 9)); setTimeout(() => { process.stdout.write(token.slice(9)); process.stderr.write(token); }, 30);`);
	try {
		await supervisor.models.save([{ id: "rally-token", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady();
		runtime!.registerProvider("rally-token", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-token", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "rally-token", model: "worker", thinkingLevel: "off" });
		let requested = false, step = 0, credentialId = "";
		const respond: FauxResponseStep = (context, _options, _state, model) => {
			observations.push(JSON.stringify(context.messages));
			const names = getCurrentTools(context.messages).map(tool => tool.name);
			expect(names).toContain("credential_list");
			const call = (name: string, input: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage(fauxToolCall(name, input), { stopReason: "toolUse" });
			if (model.id === "main") {
				if (!requested) { requested = true; return call("credential_request", { service: "Gitee", kind: "secret", label: "项目维护" }); }
				return fauxAssistantMessage("已收到密码本状态。");
			}
			if (step++ === 0) return call("credential_list", { service: "Gitee" });
			const result = JSON.parse(getMessageText(context.messages.findLast(message => message.role === "toolResult")));
			if (step === 2) {
				credentialId = result.credentials[0].id;
				expect(result.credentials[0].kind).toBe("secret");
				const command = `${process.platform === "win32" ? "& " : ""}"${process.execPath}" "${script}"`;
				return call(process.platform === "win32" ? "powershell" : "bash", { command, credentialEnv: { GITEE_TOKEN: { id: credentialId } } });
			}
			if (step === 3) {
				expect(result.exitCode).toBe(0); expect(result.output).toContain("TOKEN_OK [REDACTED]");
				return call("http_request", { method: "GET", url: `http://127.0.0.1:${address.port}`, headers: { Authorization: `Bearer {{credential:${credentialId}:secret}}` } });
			}
			if (step === 4) {
				expect(result.status).toBe(200); expect(result.body).toContain("Bearer [REDACTED]");
				return call("task_report", { state: "ready", summary: "命令行与 HTTP 的 Token 使用完成。" });
			}
			return fauxAssistantMessage("完成。");
		};
		harness.setResponses(Array(18).fill(respond));
		await supervisor.start(); await supervisor.main.send("请使用 Gitee Token 维护项目。");
		await vi.waitFor(() => { expect(supervisor.websiteAccounts.state().requests).toHaveLength(1); expect(supervisor.main.isBusy()).toBe(false); }, { timeout: 10000 });
		const handlers = cloudCommands(businessHandlers(paths, supervisor, () => {}));
		const request = supervisor.websiteAccounts.state().requests[0];
		handlers[C.credentialsSubmit]({ requestId: request.id, website: request.origin, password: token });
		const task = supervisor.store.create({ title: "Token 离线验证", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "readonly", dependsOn: [], autoApprove: false }).task;
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"), { timeout: 30000 });
		expect(received).toBe(`Bearer ${token}`);
		for (const text of [...observations, JSON.stringify(supervisor.events.all()), JSON.stringify(supervisor.main.state()), readFileSync(join(paths.sessionsTasksDir, `${task.id}.jsonl`), "utf8"), readFileSync(join(paths.jobsDir, "J-1.log"), "utf8")]) expect(text).not.toContain(token);
		handlers[C.credentialsUpdate](credentialId, false);
		expect(() => supervisor.websiteAccounts.valueForHost({ id: credentialId })).toThrow("已停用");
	} finally {
		await supervisor.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await harness.cleanup();
	}
}, 45000);
