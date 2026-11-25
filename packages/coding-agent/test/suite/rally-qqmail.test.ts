import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall, getCurrentTools, type TranscriptContext } from "@rally/ai";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "@rally/coding-agent";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { McpStore } from "../../../../src/main/mcp-store.ts";
import { QqMailConnection } from "../../../../src/main/qqmail-connection.ts";
import type { QqMailTransport } from "../../../../src/main/qqmail-transport.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { createQqMailTools } from "../../../../src/main/supervisor/qqmail-tools.ts";
import { rallyState } from "../../../../src/main/supervisor/rally-state.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const credentials = { address: "fixture@qq.com", authorizationCode: "fixture-authorization-code" };
const vault = { encrypt: (code: string) => Buffer.from([...code].reverse().join("")), decrypt: (data: Buffer) => [...data.toString()].reverse().join("") };
const ref = { uid: 5, uidValidity: "1024" };
const content = Buffer.from("report attachment\n");
const destination = "approval@example.invalid";
const draft = { to: [destination], subject: "Fixture subject", text: "Private draft body for approval", replyTo: ref, attachments: ["reply.txt"] };
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const text = (value: string) => fauxAssistantMessage(fauxText(value));
const transcript = (context: TranscriptContext) => context.messages.map(getMessageText).join("\n");
const tools = (context: TranscriptContext) => getCurrentTools(context.messages).map(tool => tool.name).filter(name => name.startsWith("qqmail_"));

function fixtureTransport() {
	return {
		verify: vi.fn<QqMailTransport["verify"]>(async () => {}),
		search: vi.fn<QqMailTransport["search"]>(async () => [{ ref, subject: "Incoming fixture", from: [] }]),
		read: vi.fn<QqMailTransport["read"]>(async () => ({ subject: "Incoming fixture", from: [], text: "Inbox fixture body", messageId: "<fixture@example.invalid>",
			attachments: [{ filename: "../../escape.txt", contentType: "text/plain", content }] })),
		send: vi.fn<QqMailTransport["send"]>(async (_auth, _message, signal) => {
			signal.throwIfAborted();
			return { messageId: "sent-fixture", accepted: [destination], rejected: [] };
		}),
	};
}

const harnesses: Harness[] = [];
const supervisors: Supervisor[] = [];
const mailFixtures: { connection: QqMailConnection; gates: GateService }[] = [];
afterEach(async () => {
	for (const { connection, gates } of mailFixtures.splice(0)) { connection.dispose(); gates.dispose(); }
	try { await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose())); }
	finally { for (const harness of harnesses.splice(0)) harness.cleanup(); vi.unstubAllEnvs(); }
}, 15000);

async function setup() {
	vi.stubEnv("PI_OFFLINE", "1");
	const harness = await createHarness({ provider: "rally-mail-test", models: [{ id: "mail-faux" }] });
	harnesses.push(harness);
	const paths = resolveRallyPaths(join(harness.tempDir, "home"));
	ensureRallyDirs(paths);
	const transport = fixtureTransport();
	const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: vault, qqMailTransport: transport });
	supervisors.push(supervisor);
	await supervisor.models.save([{ id: "rally-mail-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: [defaultModel("mail-faux")] }]);
	const runtime = await supervisor.models.whenReady();
	if (!runtime) throw new Error("Missing model runtime");
	runtime.registerProvider("rally-mail-test", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
	const selection = { provider: "rally-mail-test", model: "mail-faux", thinkingLevel: "off" as const };
	supervisor.models.setActive(selection);
	await supervisor.models.selectWorker(selection);
	await supervisor.qqMail.save(credentials);
	await supervisor.start();
	return { harness, paths, supervisor, transport };
}

it.each(["allow", "deny", "disconnect"] as const)("enforces the desktop mail approval boundary: %s", async action => {
	const { harness, paths, supervisor, transport } = await setup();
	harness.setResponses([
		context => {
			expect(transcript(context)).toContain("QQ Mail worker tools");
			expect(transcript(context)).not.toContain(credentials.authorizationCode);
			expect(tools(context)).toEqual([]);
			const id = /User message (#\d+)/.exec(transcript(context))?.[1];
			if (!id) throw new Error("Missing user message");
			return call("task_dispatch", { title: "测试邮件", cwd: paths.workspaceDir, mode: "readonly", quotes: [{ id }] });
		},
		text("等待批准"),
		context => {
			expect(tools(context).sort()).toEqual(["qqmail_read", "qqmail_save_attachment", "qqmail_search", "qqmail_send"]);
			return call("qqmail_search", { unread: true, subject: "fixture" });
		},
		context => {
			expect(transcript(context)).toContain("Incoming fixture");
			return call("qqmail_read", { ref });
		},
		context => {
			expect(transcript(context)).toContain("Inbox fixture body");
			return call("qqmail_save_attachment", { ref, index: 1 });
		},
		() => call("qqmail_send", draft),
		text("已处理"),
		text("已记录"),
	]);
	await supervisor.main.send("查收测试附件并准备回复。");
	await vi.waitFor(() => expect(!supervisor.main.isBusy() && supervisor.main.state().messages.some(message => message.text === "等待批准")).toBe(true));
	const task = supervisor.store.list()[0];
	supervisor.approve(task.id);
	const path = join(task.outputDir, "reply.txt");
	writeFileSync(path, content);
	await vi.waitFor(() => expect(supervisor.store.get(task.id)?.gates?.[0]?.tool).toBe("qqmail_send"));
	const current = supervisor.store.get(task.id)!;
	const gate = current.gates![0];
	const saved = readdirSync(task.outputDir).find(name => name.endsWith(".attachment"));
	expect(saved).toMatch(/^qqmail-[\da-f-]+\.attachment$/);
	expect(readFileSync(join(task.outputDir, saved!))).toEqual(content);
	expect(gate).toMatchObject({ userOnly: true, escalatedAt: expect.any(Number), arguments: { to: draft.to, text: draft.text, attachments: [
		{ filename: "reply.txt", size: content.length, sha256: createHash("sha256").update(content).digest("hex") },
	] } });
	for (const view of [rallyState(supervisor.store, 1, 2, true), ...(["card", "report", "timeline"] as const).map(view => JSON.stringify(readTask(supervisor.store, current, { view })))]) {
		expect(view).not.toContain(draft.text);
		expect(view).not.toContain(destination);
	}
	expect(() => supervisor.gates.decide(gate.id, "allow", "main", [], "model approval")).toThrow(/桌面确认/);
	expect(transport.send).not.toHaveBeenCalled();
	writeFileSync(path, "replacement after draft approval requested");
	if (action === "disconnect") supervisor.qqMail.disconnect();
	else supervisor.gates.decide(gate.id, action, "user", [], "desktop fixture decision");
	expect(() => supervisor.gates.decide(gate.id, "allow", "user", [], "duplicate approval")).toThrow();
	await vi.waitFor(() => expect(supervisor.store.timeline(task.id).find(item => item.name === "qqmail_send")?.status).toBe(action === "allow" ? "ok" : "error"));
	if (action === "allow") expect(transport.send).toHaveBeenCalledExactlyOnceWith(credentials, {
		to: draft.to, cc: [], subject: draft.subject, text: draft.text, inReplyTo: "<fixture@example.invalid>", attachments: [{ filename: "reply.txt", content }],
	}, expect.any(AbortSignal));
	else expect(transport.send).not.toHaveBeenCalled();
});

async function isolatedTools() {
	const harness = await createHarness(); harnesses.push(harness);
	const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
	const events = new EventLog(paths.eventsFile);
	const store = new TaskStore(events, paths.workspaceDir, () => {});
	const audit = new AuditLog(paths.auditFile, events);
	const gates = new GateService({ store, audit, events, quote: () => null, requested: () => {}, notice: () => {} });
	const transport = fixtureTransport();
	const connection = new QqMailConnection(paths.agentDir, vault, transport);
	mailFixtures.push({ connection, gates });
	await connection.save(credentials);
	const task = store.create({ title: "邮箱权限", cwd: paths.workspaceDir, quotes: [], scope: [], dependsOn: [], mode: "readonly", autoApprove: true }).task;
	const run = store.startRun(task.id, "dispatch", "faux");
	mkdirSync(task.outputDir, { recursive: true });
	const permissions = new McpStore(paths.agentDir);
	const tools = createQqMailTools(connection, { task, run, gates, audit, store, permissions });
	expect(permissions.connectorTools("qqmail").map(tool => tool.name).sort()).toEqual(tools.map(tool => tool.name).sort());
	const invoke = (name: string, input: Record<string, unknown>, id: string) => {
		const tool = tools.find(tool => tool.name === name);
		if (!tool) throw new Error(`Missing ${name}`);
		return tool.execute(id, input, undefined, undefined, {} as ExtensionToolContext);
	};
	return { paths, events, task, gates, permissions, connection, transport, invoke };
}

it.each(["qqmail_search", "qqmail_read", "qqmail_save_attachment"])("enforces live permission changes and disconnects for %s", async name => {
	const { task, gates, permissions, connection, transport, invoke, events } = await isolatedTools();
	const input = name === "qqmail_search" ? { subject: "fixture" } : name === "qqmail_read" ? { ref } : { ref, index: 1 };
	permissions.setConnectorTier("qqmail", name, "irreversible");
	const waiting = invoke(name, input, "denied");
	await vi.waitFor(() => expect(task.gates?.[0]?.tool).toBe(name));
	expect(transport.search).not.toHaveBeenCalled(); expect(transport.read).not.toHaveBeenCalled();
	permissions.setConnectorTier("qqmail", name, "reversible");
	const gate = task.gates![0];
	expect(gate.decision).toBeUndefined();
	gates.escalate(task.id, gate.id); gates.decide(gate.id, "deny", "user", [], "拒绝本次操作");
	await expect(waiting).rejects.toThrow("GATE_DENIED");
	expect(transport.search).not.toHaveBeenCalled(); expect(transport.read).not.toHaveBeenCalled();
	permissions.setConnectorTier("qqmail", name, "external");
	await invoke(name, input, "external");
	expect(events.ofKind("audit_appended").some(event => event.data.action === name && event.data.kind === "external")).toBe(true);
	expect(task.lastExternalAction).toBeDefined();
	expect(task.gates).toHaveLength(1);
	permissions.setConnectorTier("qqmail", name, "irreversible");
	const revoked = invoke(name, input, "revoked");
	await vi.waitFor(() => expect(task.gates).toHaveLength(2));
	connection.disconnect();
	await expect(revoked).rejects.toThrow();
	expect(transport.search.mock.calls.length + transport.read.mock.calls.length).toBe(1);
});

it.each(["external", "reversible"] as const)("sends with the saved %s tier and reinstates approval on the next call", async tier => {
	const { task, gates, permissions, transport, invoke, events } = await isolatedTools();
	writeFileSync(join(task.outputDir, "reply.txt"), content);
	permissions.setConnectorTier("qqmail", "qqmail_send", tier);
	await invoke("qqmail_send", draft, "without-gate");
	expect(transport.send).toHaveBeenCalledOnce();
	expect(task.gates ?? []).toHaveLength(0);
	const audits = events.ofKind("audit_appended").filter(event => event.data.action === "qqmail_send");
	expect(audits.map(event => event.data.result)).toEqual(["attempt", "submitted"]);
	for (const event of audits) { expect(event.data.tier).toBe(tier); expect(event.data.gateActor).toBeUndefined(); }
	permissions.setConnectorTier("qqmail", "qqmail_send", "irreversible");
	const waiting = invoke("qqmail_send", draft, "with-gate");
	await vi.waitFor(() => expect(task.gates?.[0]?.userOnly).toBe(true));
	permissions.setConnectorTier("qqmail", "qqmail_send", tier);
	expect(transport.send).toHaveBeenCalledOnce();
	gates.decide(task.gates![0].id, "deny", "user", [], "拒绝本次发送");
	await expect(waiting).rejects.toThrow("GATE_DENIED");
	expect(transport.send).toHaveBeenCalledOnce();
});

it("rejects malformed saved permissions instead of bypassing send approval", async () => {
	const { paths, transport, invoke } = await isolatedTools();
	writeFileSync(join(paths.agentDir, "settings.json"), JSON.stringify({ mcpTiers: { qqmail_send: ["irreversible"] } }));
	await expect(invoke("qqmail_send", { to: [destination], subject: "fixture", text: "fixture" }, "invalid-permission")).rejects.toThrow("MCP_RISK_CONFIG_INVALID");
	expect(transport.send).not.toHaveBeenCalled();
});

it("persists only verified credentials and revokes a Worker lease upon account change", async () => {
	const harness = await createHarness();
	harnesses.push(harness);
	const transport = fixtureTransport();
	const connection = new QqMailConnection(harness.tempDir, vault, transport);
	const file = join(harness.tempDir, "qqmail-connection.json");
	try {
		transport.verify.mockRejectedValueOnce(new Error(credentials.authorizationCode));
		await expect(connection.save(credentials)).rejects.toThrow(/无法验证/);
		expect(existsSync(file)).toBe(false);
		await connection.save(credentials);
		expect(readFileSync(file, "utf8")).not.toContain(credentials.authorizationCode);
		expect(JSON.stringify(connection.state())).not.toContain(credentials.authorizationCode);
		const lease = connection.lease()!;
		await connection.save({ ...credentials, address: "other@qq.com" });
		await expect(lease.run(async () => "never run")).rejects.toHaveProperty("name", "AbortError");
		const restored = new QqMailConnection(harness.tempDir, vault, transport);
		try {
			expect(restored.state()).toMatchObject({ status: "connected", address: "other@qq.com" });
			restored.disconnect();
			expect(existsSync(file)).toBe(false);
		} finally { restored.dispose(); }
	} finally { connection.dispose(); }
});
