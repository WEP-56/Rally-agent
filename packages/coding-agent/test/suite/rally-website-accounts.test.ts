import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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
