// M0 probe for docs/改造计划.md appendix B items 1-7. Faux provider only; everything lives in a temp dir.
// Run: node scripts/probes/m0-session-api.ts

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@rally/ai/compat";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@rally/ai/providers/faux";
import {
	createAgentSession,
	createPowerShellTool,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@rally/coding-agent";
import { Type } from "typebox";

const root = mkdtempSync(join(tmpdir(), "rally-m0-"));
let seq = 0;

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (t: string) => fauxAssistantMessage(fauxText(t));
const toolCall = (name: string, args: any) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

function contentText(message: any): string {
	const content = message.content;
	if (typeof content === "string") return content;
	return (content ?? []).map((p: any) => p.text ?? `[${p.type}:${p.name ?? ""}]`).join(" ");
}

const brief = (messages: any[]) => messages.map((m) => `${m.role}: ${contentText(m).slice(0, 60)}`);

async function setup(opts: {
	tools?: string[];
	customTools?: any[];
	systemPrompt?: string;
	extensionFactories?: any[];
	sessionManager?: (cwd: string) => SessionManager;
	cwd?: string;
	modelId?: string;
}) {
	const name = `faux-${++seq}`;
	const dir = join(root, name);
	const agentDir = join(dir, "agent");
	const cwd = opts.cwd ?? join(dir, "cwd");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ [name]: { type: "api_key", key: "faux-key" } }));

	const faux = registerFauxProvider({
		provider: name,
		models: [
			{ id: "m1", name: "m1" },
			{ id: "m2", name: "m2" },
		] as any,
	});
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
	});
	modelRuntime.registerProvider(name, {
		baseUrl: faux.getModel().baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((m) => ({
			id: m.id,
			name: m.name,
			api: m.api,
			reasoning: m.reasoning,
			input: m.input,
			inputLimits: m.inputLimits,
			cost: m.cost,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			baseUrl: m.baseUrl,
		})),
	} as any);

	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noSkills: true,
		noContextFiles: true,
		systemPrompt: opts.systemPrompt,
		extensionFactories: opts.extensionFactories,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		settingsManager,
		resourceLoader,
		model: faux.getModel(opts.modelId ?? "m1"),
		tools: opts.tools ?? [],
		customTools: opts.customTools,
		sessionManager: opts.sessionManager?.(cwd) ?? SessionManager.inMemory(cwd),
	});
	return { session, faux, cwd, dir, agentDir, modelRuntime };
}

function slowTool(name: string, gate: Promise<void>, started?: () => void, log?: string[]) {
	return {
		name,
		label: name,
		description: "probe tool",
		parameters: Type.Object({}),
		execute: async () => {
			log?.push(`${name}:start`);
			started?.();
			await gate;
			log?.push(`${name}:end`);
			return { content: [{ type: "text", text: `${name} done` }], details: {} };
		},
	};
}

async function b1() {
	const a = await setup({ tools: ["read"], systemPrompt: "PROMPT-A" });
	const b = await setup({ tools: ["read", "ls"], systemPrompt: "PROMPT-B", modelId: "m2" });
	writeFileSync(join(a.cwd, "marker.txt"), "MARKER-A");
	writeFileSync(join(b.cwd, "marker.txt"), "MARKER-B");
	const seen: Record<string, unknown> = {};
	const script = (label: string) => [
		toolCall("read", { path: "marker.txt" }),
		(context: any, _o: any, _s: any, model: any) => {
			seen[label] = {
				system: context.systemPrompt?.slice(0, 20),
				tools: context.tools?.map((t: any) => t.name),
				model: model.id,
				toolResult: contentText(context.messages.at(-1)),
			};
			return text("ok");
		},
	];
	a.faux.setResponses(script("A") as any);
	b.faux.setResponses(script("B") as any);
	const before = process.cwd();
	await Promise.all([a.session.prompt("go"), b.session.prompt("go")]);
	return { seen, processCwdUnchanged: before === process.cwd() };
}

async function b2() {
	const cwd = join(root, "b2");
	mkdirSync(cwd);
	const tool = createPowerShellTool(cwd) as any;
	const ok = await tool.execute("1", { command: "Write-Output hi" });
	const fail = await tool.execute("2", { command: "exit 3" }).catch((e: Error) => ({ thrown: e.message }));
	return {
		ok: { isError: ok.isError, structured: ok.structuredContent, detailsKeys: Object.keys(ok.details ?? {}) },
		fail: fail.thrown ? fail : { isError: fail.isError, structured: fail.structuredContent },
	};
}

async function b3() {
	const out: Record<string, unknown> = {};

	// Idle: custom message with triggerTurn starts a turn; without it, only joins the context.
	{
		const { session, faux } = await setup({});
		let context: string[] = [];
		const capture = (c: any) => {
			context = brief(c.messages);
			return text("reply");
		};
		faux.setResponses([capture, capture] as any);
		await session.sendCustomMessage(
			{ customType: "note", content: "SILENT-NOTE", display: false },
			{ triggerTurn: false },
		);
		out.silentNote_callsAfter = faux.state.callCount;
		await session.sendCustomMessage(
			{ customType: "relay", content: "WAKE-RELAY", display: true },
			{ triggerTurn: true },
		);
		await session.agent.waitForIdle();
		out.wakeIdle_callsAfter = faux.state.callCount;
		out.wakeIdle_context = context;
	}

	// Busy: steer during a batch of two tool calls.
	{
		const gate = deferred();
		const started = deferred();
		const log: string[] = [];
		const { session, faux } = await setup({
			tools: ["slow", "second"],
			customTools: [slowTool("slow", gate.promise, started.resolve, log), slowTool("second", Promise.resolve(), undefined, log)],
		});
		let afterSteer: string[] = [];
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("slow", {}), fauxToolCall("second", {})], { stopReason: "toolUse" }),
			(c: any) => {
				afterSteer = brief(c.messages);
				return text("done");
			},
		] as any);
		const run = session.prompt("go");
		await started.promise;
		await session.steer("STEER-NOW");
		await session.sendCustomMessage({ customType: "relay", content: "BUSY-RELAY", display: true }, { deliverAs: "steer" });
		gate.resolve();
		await run;
		out.steer_toolOrder = log;
		out.steer_nextCallContext = afterSteer;
		out.steer_llmCalls = faux.state.callCount;
	}

	// Busy: triggerTurn false must wait for the turn boundary.
	{
		const gate = deferred();
		const started = deferred();
		const { session, faux } = await setup({
			tools: ["slow"],
			customTools: [slowTool("slow", gate.promise, started.resolve)],
		});
		let after: string[] = [];
		faux.setResponses([
			toolCall("slow", {}),
			(c: any) => {
				after = brief(c.messages);
				return text("done");
			},
		] as any);
		const run = session.prompt("go");
		await started.promise;
		await session.sendCustomMessage(
			{ customType: "note", content: "BUSY-SILENT", display: false },
			{ triggerTurn: false },
		);
		gate.resolve();
		await run;
		out.busySilent_nextCallContext = after;
		out.busySilent_llmCalls = faux.state.callCount;
	}
	return out;
}

async function b4() {
	let calls = 0;
	const { session, faux } = await setup({
		extensionFactories: [
			(pi: any) => {
				pi.on("context", (event: any) => {
					calls++;
					return {
						messages: [
							...event.messages,
							{ role: "user", content: [{ type: "text", text: `<rally-state>${calls}</rally-state>` }], timestamp: Date.now() },
						],
					};
				});
			},
		],
	});
	const seen: string[][] = [];
	const capture = (c: any) => {
		seen.push(brief(c.messages));
		return text("ok");
	};
	faux.setResponses([capture, capture] as any);
	await session.prompt("one");
	await session.prompt("two");
	return { hookCalls: calls, seen, persisted: brief(session.messages as any[]) };
}

async function b5() {
	const out: Record<string, unknown> = {};

	// Long async wait, then block.
	{
		const pending = deferred<{ block: true; reason: string }>();
		const entered = deferred();
		const log: string[] = [];
		const { session, faux } = await setup({
			tools: ["danger"],
			customTools: [slowTool("danger", Promise.resolve(), undefined, log)],
			extensionFactories: [
				(pi: any) => {
					pi.on("tool_call", async () => {
						entered.resolve();
						return pending.promise;
					});
				},
			],
		});
		const events: any[] = [];
		session.subscribe((e: any) => {
			if (e.type === "tool_execution_end") events.push({ tool: e.toolName, isError: e.isError, result: contentText(e.result) });
		});
		let toolResult = "";
		faux.setResponses([
			toolCall("danger", {}),
			(c: any) => {
				toolResult = `${c.messages.at(-1).role} isError=${c.messages.at(-1).isError}: ${contentText(c.messages.at(-1))}`;
				return text("understood");
			},
		] as any);
		const run = session.prompt("go");
		await entered.promise;
		const t0 = Date.now();
		await sleep(5000);
		out.waited_ms = Date.now() - t0;
		out.isStreamingWhilePending = session.isStreaming;
		out.toolRanWhilePending = log.length > 0;
		pending.resolve({ block: true, reason: "denied by gate G-1" });
		await run;
		out.toolRanAfterBlock = log.length > 0;
		out.executionEndEvents = events;
		out.modelSawToolResult = toolResult;
	}

	// abort() while the hook is pending and ignores the signal.
	{
		const pending = deferred<undefined>();
		const entered = deferred();
		const { session, faux } = await setup({
			tools: ["danger"],
			customTools: [slowTool("danger", Promise.resolve())],
			extensionFactories: [
				(pi: any) => {
					pi.on("tool_call", async () => {
						entered.resolve();
						return pending.promise;
					});
				},
			],
		});
		faux.setResponses([toolCall("danger", {}), text("x")] as any);
		const run = session.prompt("go").catch((e: Error) => `rejected: ${e.message}`);
		await entered.promise;
		const abort = session.abort().then(() => "abort resolved");
		out.abort_ignoringSignal = await Promise.race([abort, sleep(2000).then(() => "abort still pending after 2s")]);
		pending.resolve(undefined);
		await abort;
		await run;
	}

	// abort() while the hook honours ctx.signal.
	{
		const entered = deferred();
		const { session, faux } = await setup({
			tools: ["danger"],
			customTools: [slowTool("danger", Promise.resolve())],
			extensionFactories: [
				(pi: any) => {
					pi.on("tool_call", async (_event: any, ctx: any) => {
						entered.resolve();
						await new Promise<void>((resolve) => ctx.signal?.addEventListener("abort", () => resolve(), { once: true }));
						return { block: true, reason: "aborted" };
					});
				},
			],
		});
		faux.setResponses([toolCall("danger", {}), text("x")] as any);
		const run = session.prompt("go").catch((e: Error) => `rejected: ${e.message}`);
		await entered.promise;
		const abort = session.abort().then(() => "abort resolved");
		out.abort_honouringSignal = await Promise.race([abort, sleep(2000).then(() => "abort still pending after 2s")]);
		await run;
	}
	return out;
}

async function b6() {
	const gate = deferred();
	const started = deferred();
	const { session, faux } = await setup({
		tools: ["slow"],
		customTools: [slowTool("slow", gate.promise, started.resolve)],
	});
	const models: string[] = [];
	const record = (_c: any, _o: any, _s: any, model: any) => {
		models.push(model.id);
		return text("ok");
	};
	faux.setResponses([
		record,
		(_c: any, _o: any, _s: any, model: any) => {
			models.push(model.id);
			return toolCall("slow", {});
		},
		record,
	] as any);
	await session.prompt("one");
	await session.setModel(faux.getModel("m2")!);
	const run = session.prompt("two");
	await started.promise;
	await session.setModel(faux.getModel("m1")!);
	gate.resolve();
	await run;
	return { modelsPerCall: models, note: "expected m1, then m2, then m1 if a mid-run switch applies to the next call" };
}

async function b7() {
	const out: Record<string, unknown> = {};
	const dir = join(root, "b7", "tasks");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "T-1045.jsonl");

	const first = await setup({ sessionManager: (cwd) => SessionManager.open(file, undefined, cwd) });
	first.faux.setResponses([text("first reply")] as any);
	await first.session.prompt("first");
	out.explicitPath_exists = existsSync(file);
	out.explicitPath_sessionFile = first.session.sessionManager.getSessionFile()?.endsWith("T-1045.jsonl");
	first.session.dispose();

	const second = await setup({ sessionManager: (cwd) => SessionManager.open(file, undefined, cwd), modelId: "m2" });
	let resumed: string[] = [];
	second.faux.setResponses([
		(c: any) => {
			resumed = brief(c.messages);
			return text("second reply");
		},
	] as any);
	await second.session.prompt("second");
	out.resume_context = resumed;
	out.resume_entries = readFileSync(file, "utf-8").trim().split("\n").length;
	second.session.dispose();

	let nextFile: string | undefined;
	let seeded: string[] = [];
	const seededSetup = await setup({
		sessionManager: (cwd) => {
			const sm = SessionManager.create(cwd, join(root, "b7", "main"), { parentSession: file });
			sm.appendCompaction("SUMMARY-OF-PREVIOUS-SEGMENT", null, 1234);
			return sm;
		},
	});
	seededSetup.faux.setResponses([
		(c: any) => {
			seeded = brief(c.messages);
			return text("seeded reply");
		},
	] as any);
	await seededSetup.session.prompt("after seed");
	nextFile = seededSetup.session.sessionManager.getSessionFile();
	out.seeded_context = seeded;
	out.seeded_parent = seededSetup.session.sessionManager.getHeader()?.parentSession === file;
	out.seeded_fileName = nextFile?.split(/[\\/]/).pop();

	const reopened = SessionManager.open(file, undefined, seededSetup.cwd);
	const before = reopened.getSessionFile();
	reopened.newSession({ parentSession: file });
	out.newSession_keepsExplicitPath = reopened.getSessionFile() === before;
	return out;
}

// Synchronous on purpose: the script ends with process.exit, which would drop buffered pipe output.
const emit = (line: string) => appendFileSync(process.env.PROBE_OUT ?? join(tmpdir(), "rally-m0-probe.txt"), line);
const cases = { b1, b2, b3, b4, b5, b6, b7 };
const only = process.argv.slice(2);
emit(`probe start, temp root ${root}\n`);
for (const [name, run] of Object.entries(cases)) {
	if (only.length && !only.includes(name)) continue;
	try {
		emit(`\n=== ${name}\n${JSON.stringify(await run(), null, 2)}\n`);
	} catch (error) {
		emit(`\n=== ${name} FAILED\n${(error as Error).stack}\n`);
	}
}
emit("\nprobe end\n");
rmSync(root, { recursive: true, force: true });
process.exit(0);
