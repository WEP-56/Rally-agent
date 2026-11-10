// Both roles use this path so loader initialization and tool allowlists cannot drift apart.
import { type AgentSession, createAgentSession, DefaultResourceLoader, type ExtensionFactory } from "@rally/coding-agent";
import { SkillStore } from "../skill-store.ts";
import { projectSettings } from "../project-trust.ts";

type SessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;

export async function createRoleSession(options: SessionOptions & { rolePrompt: string; loadProjectContext?: boolean; loadProjectSkills?: boolean; extensions?: ExtensionFactory[]; extensionTools?: string[]; startupSignal?: AbortSignal; onSessionCreated?(session: AgentSession): void }) {
	const { rolePrompt, loadProjectContext = false, loadProjectSkills = false, extensions, extensionTools = [], startupSignal, onSessionCreated, ...sessionOptions } = options;
	startupSignal?.throwIfAborted();
	if (!options.cwd || !options.agentDir) throw new Error("Rally 会话必须显式指定 cwd 和 agentDir");
	const settingsManager = projectSettings(options.cwd, options.agentDir, loadProjectContext);
	const loader = new DefaultResourceLoader({
		settingsManager,
		cwd: options.cwd,
		agentDir: options.agentDir,
		noContextFiles: !loadProjectContext,
		noExtensions: true,
		extensionFactories: extensions,
		noSkills: !loadProjectSkills,
		...(loadProjectSkills ? new SkillStore(options.agentDir).loaderOptions() : {}),
		noPromptTemplates: true,
		noThemes: true,
		systemPrompt: rolePrompt,
	});
	// The SDK does not reload a caller-supplied loader.
	await loader.reload();
	startupSignal?.throwIfAborted();
	const extensionErrors = loader.getExtensions().errors;
	if (extensionErrors.length) throw new Error(extensionErrors.map((item) => `${item.path}: ${item.error}`).join("\n"));
	const tools = [...new Set([...(options.tools ?? []), ...(options.customTools ?? []).map((tool) => tool.name)])];
	const result = await createAgentSession({ ...sessionOptions, settingsManager, tools: [...tools, ...extensionTools], resourceLoader: loader });
	try {
		onSessionCreated?.(result.session);
		startupSignal?.throwIfAborted();
		if (extensions?.length) await result.session.bindExtensions({});
		startupSignal?.throwIfAborted();
	} catch (error) {
		await closeRoleSession(result.session);
		throw error;
	}
	const active = new Set(result.session.getActiveToolNames());
	const missing = tools.filter((name) => !active.has(name));
	if (missing.length > 0 || !result.session.systemPrompt.includes(rolePrompt)) {
		await closeRoleSession(result.session);
		throw new Error(`Rally 会话初始化不完整${missing.length ? `，缺少工具：${missing.join("、")}` : "，角色指令未生效"}`);
	}
	return result;
}

const closingSessions = new WeakMap<AgentSession, Promise<void>>();

/** SDK dispose does not emit session_shutdown; MCP transports need that lifecycle event. */
export function closeRoleSession(session: AgentSession): Promise<void> {
	const existing = closingSessions.get(session);
	if (existing) return existing;
	// Closing transports also unblocks a prompt waiting on MCP startup or a hanging call.
	// Start both operations before waiting: abort alone may wait for those connections.
	const closing = Promise.allSettled([
		session.abort(),
		session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
	]).then((results) => {
		const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
		if (errors.length) throw new AggregateError(errors, "Rally session shutdown failed");
	}).finally(() => session.dispose());
	closingSessions.set(session, closing);
	return closing;
}
