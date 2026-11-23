import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type FauxResponseStep } from "@rally/ai";
import { expect, it, vi } from "vitest";
import { cloudVault } from "../../../../src/main/cloud/vault.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText } from "./harness.ts";

it("production Worker logs in through the host, observes no plaintext and releases the task window", async () => {
	const harness = await createHarness({ provider: "rally-browser", models: [{ id: "main" }, { id: "worker" }] });
	const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths); mkdirSync(paths.workspaceDir, { recursive: true });
	const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: cloudVault(randomBytes(32)) });
	const username = "UNIQUE-BROWSER-ACCOUNT", password = "UNIQUE-BROWSER-PASSWORD";
	let received = "";
	const server = createServer((req, res) => {
		if (req.url === "/login") { req.on("data", chunk => { received += chunk; }); req.on("end", () => res.end("ok")); return; }
		res.setHeader("Content-Type", "text/html"); res.end('<input aria-label="Account"><input aria-label="Password" type="password"><button onclick="fetch(\'/login\', {method:\'POST\', body: JSON.stringify([...document.querySelectorAll(\'input\')].map(i=>i.value))})">Login</button>');
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); if (!address || typeof address === "string") throw Error("fixture address missing");
	const url = `http://127.0.0.1:${address.port}`;
	const traces: string[] = [];
	try {
		await supervisor.models.save([{ id: "rally-browser", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady();
		runtime!.registerProvider("rally-browser", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-browser", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "rally-browser", model: "worker", thinkingLevel: "off" });
		supervisor.websiteAccounts.request("fixture", url);
		supervisor.websiteAccounts.submit({ requestId: "fixture", website: url, username, password });
		let step = 0, windowId = "";
		const respond: FauxResponseStep = (context, _options, _state, model) => {
			traces.push(JSON.stringify(context.messages));
			const names = getCurrentTools(context.messages).map(tool => tool.name);
			if (model.id === "main") { expect(names.some(name => name.startsWith("browser_"))).toBe(false); return fauxAssistantMessage("已收到任务结果。"); }
			expect(names).toContain("browser_login"); expect(names).not.toContain("credential_request");
			const reply = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
			const last = context.messages.findLast(message => message.role === "toolResult");
			if (step++ === 0) return reply("browser_open", { url });
			const data = JSON.parse(getMessageText(last));
			if (step === 2) { windowId = data.id; return reply("browser_snapshot", { windowId }); }
			if (step === 3) {
				const ref = (label: string) => new RegExp(`"${label}" \\[ref=(\\w+)\\]`).exec(data.snapshot)![1];
				return reply("browser_login", { windowId, epoch: data.epoch, document: data.document, accountId: data.accounts[0].id, usernameRef: ref("Account"), passwordRef: ref("Password") });
			}
			if (step === 4) return reply("browser_snapshot", { windowId });
			if (step === 5) return reply("browser_action", { windowId, epoch: data.epoch, document: data.document, action: { kind: "click", ref: /button "Login" \[ref=(\w+)\]/.exec(data.snapshot)![1] }, irreversible: false, reason: "使用已保存账号登录" });
			return reply("task_report", { state: "ready", summary: "已完成测试网站登录。" });
		};
		harness.setResponses(Array(16).fill(respond));
		await supervisor.start();
		const task = supervisor.store.create({ title: "网站登录", quotes: [{ messageId: "#fixture", kind: "user", text: "登录测试网站", at: Date.now() }], cwd: paths.workspaceDir, scope: [], mode: "readonly", dependsOn: [], autoApprove: false }).task;
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(supervisor.store.get(task.id)?.ended?.outcome).toBe("done"), { timeout: 20000 });
		await vi.waitFor(() => expect(supervisor.agentBrowser.state().every(window => window.owner === "closed")).toBe(true), { timeout: 10000 });
		expect(JSON.parse(received)).toEqual([username, password]);
		for (const trace of [...traces, JSON.stringify(supervisor.events.all()), JSON.stringify(supervisor.main.state()), readFileSync(join(paths.sessionsTasksDir, `${task.id}.jsonl`), "utf8")]) { expect(trace).not.toContain(username); expect(trace).not.toContain(password); }
	} finally { await supervisor.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); await harness.cleanup(); }
}, 40000);
