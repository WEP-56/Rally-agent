// Both roles use this path so loader initialization and tool allowlists cannot drift apart.
import { createAgentSession, DefaultResourceLoader } from "@rally/coding-agent";

type SessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;

export async function createRoleSession(options: SessionOptions & { rolePrompt: string; loadProjectContext?: boolean }) {
	const { rolePrompt, loadProjectContext = false, ...sessionOptions } = options;
	if (!options.cwd || !options.agentDir) throw new Error("Rally 会话必须显式指定 cwd 和 agentDir");
	const loader = new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		noContextFiles: !loadProjectContext,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		systemPrompt: rolePrompt,
	});
	// The SDK does not reload a caller-supplied loader.
	await loader.reload();
	const tools = [...new Set([...(options.tools ?? []), ...(options.customTools ?? []).map((tool) => tool.name)])];
	const result = await createAgentSession({ ...sessionOptions, tools, resourceLoader: loader });
	const active = new Set(result.session.getActiveToolNames());
	const missing = tools.filter((name) => !active.has(name));
	if (missing.length > 0 || !result.session.systemPrompt.includes(rolePrompt)) {
		result.session.dispose();
		throw new Error(`Rally 会话初始化不完整${missing.length ? `，缺少工具：${missing.join("、")}` : "，角色指令未生效"}`);
	}
	return result;
}
