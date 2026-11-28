import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Server, type Connection, type ServerChannel } from "ssh2";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "@rally/coding-agent";
import { fauxAssistantMessage, fauxText, fauxToolCall, getCurrentTools, validateToolArguments, type JsonObject } from "@rally/ai";
import { SshConnections } from "../../../../src/main/ssh-connection.ts";
import { SshSessions } from "../../../../src/main/supervisor/ssh-sessions.ts";
import { createSshTools } from "../../../../src/main/supervisor/ssh-tools.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { McpStore } from "../../../../src/main/mcp-store.ts";
import { WebsiteAccounts } from "../../../../src/main/website-accounts.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { businessHandlers } from "../../../../src/main/business.ts";
import { createApi, type ClientTransport } from "../../../../src/shared/client-api.ts";
import { IpcChannel } from "../../../../src/shared/ipc.ts";
import { createHarness, getMessageText } from "./harness.ts";

const vault = { encrypt: (text: string) => Buffer.from(text).reverse(), decrypt: (value: Buffer) => Buffer.from(value).reverse().toString() };
const hostKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs(); }, 15000);

async function serverFixture() {
	const clients = new Set<Connection>();
	const commands: string[] = [];
	const inputs: string[] = [];
	const pending = new Map<string, ServerChannel>();
	let authentications = 0;
	let pty = false;
	const server = new Server({ hostKeys: [hostKey] }, client => {
		clients.add(client);
		client.on("error", () => {});
		client.on("close", () => clients.delete(client));
		client.on("authentication", context => {
			authentications++;
			if (context.method === "password" && context.password === "fixture-password") context.accept();
			else if (context.method === "publickey") context.accept();
			else context.reject();
		});
		client.on("ready", () => client.on("session", accept => {
			const session = accept();
			session.on("pty", acceptPty => { pty = true; acceptPty?.(); });
			session.on("exec", (acceptExec, _reject, info) => {
				commands.push(info.command);
				const stream = acceptExec();
				stream.on("error", () => {});
				pending.set(info.command, stream);
				if (info.command === "short") { stream.write("磁盘 ✓\n"); stream.stderr.write("fixture stderr\n"); stream.exit(3); stream.end(); }
				if (info.command === "large") { stream.write("中文😀".repeat(10000)); stream.exit(0); stream.end(); }
				if (info.command === "ask") stream.write("Continue? [y/N] ");
				if (info.command === "echo-secret") stream.write("Password: ");
				stream.on("data", (data: Buffer) => {
					inputs.push(data.toString());
					if (info.command === "echo-secret") {
						const value = data.toString().trimEnd();
						stream.write(value.slice(0, 3));
						setTimeout(() => { stream.write(value.slice(3) + "\naccepted\n"); stream.exit(0); stream.end(); }, 10);
					} else if (info.command === "interrupt" && data.toString() === "\u0003") { stream.exit("INT"); stream.end(); }
					else { stream.write(`received:${data.toString()}`); stream.exit(0); stream.end(); }
				});
			});
		}));
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	cleanups.push(async () => { for (const client of clients) client.end(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No fixture port");
	return { server, clients, commands, inputs, pending, port: address.port, authCount: () => authentications, usedPty: () => pty };
}

async function setup() {
	const harness = await createHarness();
	cleanups.push(() => harness.cleanup());
	const fixture = await serverFixture();
	const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
	const events = new EventLog(paths.eventsFile);
	cleanups.push(() => events.close());
	const store = new TaskStore(events, paths.workspaceDir, () => {});
	const task = store.create({ title: "SSH", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "write", dependsOn: [], autoApprove: true }).task;
	const run = store.startRun(task.id, "dispatch", "fixture");
	const connections = new SshConnections(paths.home, vault);
	const input = { name: "Fixture", host: "127.0.0.1", port: fixture.port, username: "fixture", auth: "password" as const, secret: "fixture-password" };
	const server = connections.save(input)[0];
	const accounts = new WebsiteAccounts(join(paths.agentDir, "accounts.txt"), vault);
	const completed: string[] = [];
	const options = { connections, credentials: accounts, store, directory: paths.jobsDir,
		onDone: (job: Parameters<TaskStore["jobDone"]>[0], text: string) => { if (store.jobDone(job, text)) completed.push(text); }, onBusyChange: () => {}, onActivity: () => {} };
	const sessions = new SshSessions(options);
	cleanups.push(() => { sessions.dispose(); connections.dispose(); });
	const audit = new AuditLog(paths.auditFile, events);
	const gates = new GateService({ store, events, audit, quote: () => null, requested: () => {}, notice: () => {} });
	cleanups.push(() => gates.dispose());
	const permissions = new McpStore(paths.agentDir);
	const tools = createSshTools(connections, sessions, { task, run, store, gates, audit, permissions });
	const invoke = async (name: string, args: JsonObject) => {
		const tool = tools.find(item => item.name === name)!;
		const id = crypto.randomUUID();
		const validated = validateToolArguments(tool, { type: "toolCall", id, name, arguments: args });
		const result = await tool.execute(id, validated, undefined, undefined, {} as ExtensionToolContext);
		const block = result.content.find(item => item.type === "text");
		if (block?.type !== "text") throw new Error("Missing text result");
		return JSON.parse(block.text);
	};
	const trust = async () => {
		const result = await connections.verify(server.id);
		expect(result.status).toBe("confirm");
		await connections.verify(server.id, result.fingerprint);
	};
	const drain = async (id: string) => {
		let output = "";
		for (let i = 0; i < 100; i++) {
			const result = await sessions.continue(task, run, id, { yieldTimeMs: 1000 });
			output += result.output;
			if (result.status !== "running" && !result.hasMore) return { ...result, output };
		}
		throw new Error("Fixture did not finish");
	};
	return { fixture, paths, task, run, store, connections, server, input, sessions, accounts, completed, options, gates, permissions, tools, invoke, trust, drain };
}

it("requires host confirmation before authentication, encrypts credentials and keeps edits private", async () => {
	const f = await setup();
	expect(JSON.stringify(f.connections.state())).not.toContain(f.input.secret);
	expect(readFileSync(join(f.paths.home, "ssh-connections.json"), "utf8")).not.toContain(f.input.secret);
	expect(() => f.connections.open(f.server.id, new AbortController().signal)).toThrow(/指纹/);
	const check = await f.connections.verify(f.server.id);
	expect(check).toMatchObject({ status: "confirm", fingerprint: expect.stringMatching(/^SHA256:/) });
	expect(f.fixture.authCount()).toBe(0);
	await expect(f.connections.verify(f.server.id, "SHA256:wrong")).rejects.toThrow();
	await expect(f.connections.verify(f.server.id, check.fingerprint)).resolves.toMatchObject({ status: "verified" });
	f.connections.save({ ...f.input, id: f.server.id, name: "Renamed", secret: undefined });
	await expect(f.connections.verify(f.server.id)).resolves.toMatchObject({ status: "verified" });
	const reloaded = new SshConnections(f.paths.home, vault); cleanups.push(() => reloaded.dispose());
	expect(reloaded.state()[0].name).toBe("Renamed");
});

it("supports an encrypted private key without an external ssh executable", async () => {
	const f = await setup();
	const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem", cipher: "aes-256-cbc", passphrase: "fixture-passphrase" }).toString();
	f.connections.save({ ...f.input, id: f.server.id, auth: "privateKey", secret: privateKey, passphrase: "fixture-passphrase" });
	await f.trust();
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "short", false, {});
	const last = await f.drain(first.sessionId);
	expect(last.exitCode).toBe(3);
	expect(first.output + last.output).toContain("磁盘 ✓");
	expect(f.completed).toHaveLength(0);
});

it("keeps PTY stdin open, reads without approval and applies permissions to each input", async () => {
	const f = await setup(); await f.trust();
	expect(f.permissions.connectorTools("ssh").map(tool => tool.name)).toEqual(f.tools.map(tool => tool.name));
	f.permissions.setConnectorTier("ssh", "ssh_exec", "reversible");
	const first = await f.invoke("ssh_exec", { serverId: f.server.id, command: "ask", tty: true });
	expect(first.output).toBe("Continue? [y/N] ");
	expect(first.status).toBe("running");
	expect(f.fixture.usedPty()).toBe(true);
	expect(await f.invoke("ssh_write_stdin", { sessionId: first.sessionId, yieldTimeMs: 0 })).toMatchObject({ output: "", status: "running" });
	expect(f.task.gates ?? []).toHaveLength(0);
	const waiting = f.invoke("ssh_write_stdin", { sessionId: first.sessionId, chars: "y\n", credential: { id: "" }, appendNewline: true });
	await vi.waitFor(() => expect(f.task.gates?.length).toBe(1));
	expect(f.fixture.inputs).toHaveLength(0);
	const gate = f.task.gates![0];
	f.gates.escalate(f.task.id, gate.id);
	f.gates.decide(gate.id, "allow", "user", [], "fixture approval");
	const next = await waiting;
	const last = await f.drain(first.sessionId);
	expect(next.output + last.output).toBe("received:y\n");
	expect(f.fixture.commands).toEqual(["ask"]);
	expect(f.fixture.inputs).toEqual(["y\n"]);
	expect(last.exitCode).toBe(0);
});

it("returns large Unicode output once in bounded chunks, retaining the log", async () => {
	const f = await setup(); await f.trust();
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "large", false, { maxOutputChars: 5 });
	expect([...first.output].length).toBeLessThanOrEqual(5);
	const last = await f.drain(first.sessionId);
	expect(first.output + last.output).toBe("中文😀".repeat(10000));
	expect(readFileSync(last.logPath, "utf8")).toBe(first.output + last.output);
	expect(await f.sessions.continue(f.task, f.run, first.sessionId, {})).toMatchObject({ output: "", hasMore: false });
});

it("treats empty optional input fields as a read after schema validation without sending bytes or asking approval", async () => {
	const f = await setup(); await f.trust();
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "ask", false, {});
	const variants: JsonObject[] = [
		{},
		{ chars: "", credential: { id: "", field: "secret" }, appendNewline: true },
		{ chars: "", credential: { id: "   " }, appendNewline: false },
		{ credential: {} },
		{ chars: null, credential: null, appendNewline: null },
		{ credential: { id: null, field: null }, appendNewline: true },
	];
	for (const input of variants) {
		expect(await f.invoke("ssh_write_stdin", { sessionId: first.sessionId, yieldTimeMs: 0, ...input })).toMatchObject({ status: "running", output: "" });
	}
	f.fixture.pending.get("ask")!.write("new output");
	expect(await f.invoke("ssh_write_stdin", { sessionId: first.sessionId, credential: { id: "" }, appendNewline: true })).toMatchObject({ output: "new output" });
	expect(f.fixture.inputs).toEqual([]);
	expect(f.task.gates ?? []).toEqual([]);

	// A real, non-empty reference is still an input operation, not a read fallback.
	f.permissions.setConnectorTier("ssh", "ssh_write_stdin", "reversible");
	await expect(f.invoke("ssh_write_stdin", { sessionId: first.sessionId, credential: { id: "missing-entry" } })).rejects.toThrow(/凭据不存在/);
	await expect(f.invoke("ssh_write_stdin", { sessionId: first.sessionId, chars: "y\n", credential: { id: "missing-entry" } })).rejects.toThrow(/只能提供一个/);
	expect(f.fixture.inputs).toEqual([]);
});

it("injects saved credentials and masks split echo before logs and model results", async () => {
	const f = await setup(); await f.trust();
	f.accounts.request("credential-fixture", "SSH sudo", { kind: "secret" });
	const saved = f.accounts.submit({ requestId: "credential-fixture", website: "SSH sudo", kind: "secret", password: "private-sudo-value" });
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "echo-secret", true, {});
	f.permissions.setConnectorTier("ssh", "ssh_write_stdin", "reversible");
	const next = await f.invoke("ssh_write_stdin", { sessionId: first.sessionId, chars: "", credential: { id: saved.accountId! } });
	const last = await f.drain(first.sessionId);
	expect(next.output + last.output).toContain("[REDACTED]");
	expect(readFileSync(last.logPath, "utf8")).not.toContain("private-sudo-value");
	expect(JSON.stringify(f.task)).not.toContain("private-sudo-value");
});

it("delivers a compact background completion once and closes cancelled task sessions", async () => {
	const f = await setup(); await f.trust();
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "wait", false, { yieldTimeMs: 0 });
	expect(first.status).toBe("running");
	f.fixture.pending.get("wait")!.write("completion-body\n");
	f.fixture.pending.get("wait")!.exit(0); f.fixture.pending.get("wait")!.end();
	await vi.waitFor(() => expect(f.completed).toHaveLength(1));
	expect(f.completed[0]).toContain(first.sessionId);
	expect(f.completed[0]).not.toContain("completion-body");
	await f.drain(first.sessionId);
	expect(f.completed).toHaveLength(1);
	const second = await f.sessions.execute(f.task, f.run, f.server.id, "cancel", false, { yieldTimeMs: 0 });
	expect(f.sessions.killTask(f.task.id)).toBe(1);
	expect(f.sessions.killTask(f.task.id)).toBe(1); // Store callback and task_cancel share the same cleanup result.
	expect(await f.sessions.continue(f.task, f.run, second.sessionId, {})).toMatchObject({ status: "closed" });
	await expect(f.sessions.continue(f.task, f.run, second.sessionId, { chars: "again\n" })).rejects.toThrow(/已结束/);
});

it("sends Ctrl+C to a PTY and reports the server's signal without fabricating an exit code", async () => {
	const f = await setup(); await f.trust();
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "interrupt", true, { yieldTimeMs: 0 });
	await f.sessions.continue(f.task, f.run, first.sessionId, { chars: "\u0003" });
	const last = await f.drain(first.sessionId);
	expect(last).toMatchObject({ status: "exited", exitSignal: "SIGINT" });
	expect(last.exitCode).toBeUndefined();
	expect(f.fixture.inputs).toEqual(["\u0003"]);
});

it("does not replay commands after disconnect and denies cross-task session access", async () => {
	const f = await setup(); await f.trust();
	const first = await f.sessions.execute(f.task, f.run, f.server.id, "disconnect", false, { yieldTimeMs: 0 });
	expect(() => f.sessions.serverId("T-other", first.sessionId)).toThrow(/不属于/);
	for (const client of f.fixture.clients) client.end();
	await vi.waitFor(() => expect(f.task.jobs?.[0].status).toBe("killed"));
	const result = await f.sessions.continue(f.task, f.run, first.sessionId, {});
	expect(result.status).toBe("disconnected");
	expect(result.exitCode).toBeUndefined();
	expect(f.fixture.commands).toEqual(["disconnect"]);
	const restored = new SshSessions(f.options); cleanups.push(() => restored.dispose());
	restored.recover();
	expect(await restored.continue(f.task, f.run, first.sessionId, {})).toMatchObject({ status: "disconnected" });
});

it("rejects a pending command when its server is disabled before approval", async () => {
	const f = await setup(); await f.trust();
	const waiting = f.invoke("ssh_exec", { serverId: f.server.id, command: "short" });
	const rejected = expect(waiting).rejects.toThrow(/修改或停用/);
	await vi.waitFor(() => expect(f.task.gates?.length).toBe(1));
	f.connections.update(f.server.id, false);
	const gate = f.task.gates![0]; f.gates.escalate(f.task.id, gate.id); f.gates.decide(gate.id, "allow", "user", [], "fixture approval");
	await rejected;
	expect(f.fixture.commands).toHaveLength(0);
});

it("passes SSH configuration through the shared client/business contract without returning secrets", async () => {
	const harness = await createHarness(); cleanups.push(() => harness.cleanup());
	const fixture = await serverFixture();
	const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
	const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: vault }); cleanups.push(() => supervisor.dispose());
	const handlers = businessHandlers(paths, supervisor, () => {});
	const invoked: string[] = [];
	const transport: ClientTransport = {
		async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
			invoked.push(channel);
			if (!Object.hasOwn(handlers, channel)) throw new Error("Unsupported channel");
			const value = await Reflect.apply(handlers[channel as keyof typeof handlers], undefined, JSON.parse(JSON.stringify(args)));
			const json = JSON.stringify(value);
			expect(json).not.toContain("fixture-password");
			return JSON.parse(json) as T;
		}, send() {}, on() {}, off() {},
	};
	const api = createApi(transport);
	const [server] = await api.ssh.save({ name: "Fixture", host: "127.0.0.1", port: fixture.port, username: "fixture", auth: "password", secret: "fixture-password" });
	const check = await api.ssh.verify(server.id);
	expect(check.status).toBe("confirm");
	expect((await api.ssh.verify(server.id, check.fingerprint)).status).toBe("verified");
	expect((await api.ssh.getState())[0].checkedAt).toBeTypeOf("number");
	expect((await api.ssh.update(server.id, false))[0].enabled).toBe(false);
	expect(await api.ssh.remove(server.id)).toEqual([]);
	expect(invoked).toEqual([IpcChannel.sshSave, IpcChannel.sshVerify, IpcChannel.sshVerify, IpcChannel.sshState, IpcChannel.sshUpdate, IpcChannel.sshRemove]);
});

it("exposes SSH to the built-in worker, keeps the router metadata-only, and uses normal task scheduling", async () => {
	vi.stubEnv("PI_OFFLINE", "1");
	const harness = await createHarness({ provider: "rally-ssh-test", models: [{ id: "ssh-faux" }] }); cleanups.push(() => harness.cleanup());
	const fixture = await serverFixture();
	const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
	const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: vault }); cleanups.push(() => supervisor.dispose());
	await supervisor.models.save([{ id: "rally-ssh-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: [defaultModel("ssh-faux")] }]);
	const runtime = await supervisor.models.whenReady();
	if (!runtime) throw new Error("No model runtime");
	runtime.registerProvider("rally-ssh-test", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
	const selection = { provider: "rally-ssh-test", model: "ssh-faux", thinkingLevel: "off" as const };
	supervisor.models.setActive(selection); await supervisor.models.selectWorker(selection);
	const server = supervisor.ssh.save({ name: "Fixture", host: "127.0.0.1", port: fixture.port, username: "fixture", auth: "password", secret: "fixture-password" })[0];
	await supervisor.ssh.verify(server.id, (await supervisor.ssh.verify(server.id)).fingerprint);
	new McpStore(paths.agentDir).setConnectorTier("ssh", "ssh_exec", "reversible");
	await supervisor.start();
	const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
	harness.setResponses([
		context => {
			const transcript = context.messages.map(getMessageText).join("\n");
			expect(transcript).toContain("SSH worker tools");
			expect(transcript).not.toContain("fixture-password");
			expect(getCurrentTools(context.messages).some(tool => tool.name === "ssh_exec")).toBe(false);
			const id = /User message (#\d+)/.exec(transcript)?.[1];
			if (!id) throw new Error("No user quote");
			return call("task_dispatch", { title: "SSH test", cwd: paths.workspaceDir, mode: "write", quotes: [{ id }] });
		},
		fauxAssistantMessage(fauxText("等待批准")),
		context => {
			expect(getCurrentTools(context.messages).filter(tool => tool.name.startsWith("ssh_")).map(tool => tool.name).sort()).toEqual(["ssh_exec", "ssh_list", "ssh_write_stdin"]);
			return call("ssh_exec", { serverId: server.id, command: "wait", yieldTimeMs: 0 });
		},
		fauxAssistantMessage(fauxText("命令正在运行。")),
	]);
	await supervisor.main.send("连接测试服务器执行维护。");
	await vi.waitFor(() => expect(supervisor.store.list()).toHaveLength(1));
	await vi.waitFor(() => expect(!supervisor.main.isBusy() && supervisor.main.state().messages.some(message => message.text === "等待批准")).toBe(true));
	const task = supervisor.store.list()[0]; supervisor.approve(task.id);
	await vi.waitFor(() => expect(supervisor.store.get(task.id)?.jobs?.[0]?.backgroundedAt).toBeTypeOf("number"));
	expect(supervisor.jobs.hasRunning(task.id)).toBe(true);
	expect(supervisor.workers.streamingIds()).toContain(task.id);
	await supervisor.cancel(task.id);
	expect(supervisor.store.get(task.id)?.jobs?.[0]).toMatchObject({ status: "killed", ssh: { status: "closed" } });
});
