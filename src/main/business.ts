import { IpcChannel, IpcEvent, type RallyPaths } from "../shared/ipc.ts";
import type { FetchModelsInput, ProviderEntry, SelectModelInput } from "../shared/models.ts";
import type { Supervisor } from "./supervisor/index.ts";
import type { WorkspacePatch } from "../shared/workspace.ts";
import { SkillStore } from "./skill-store.ts";
import { projectTrustState, setProjectTrust } from "./project-trust.ts";
import { McpStore } from "./mcp-store.ts";
import type { McpExposure, McpRiskTier } from "../shared/mcp.ts";
import type { FeishuCredentials, ImBotCredentials, QqMailCredentials } from "../shared/connections.ts";
import type { IdentityState } from "../shared/identity.ts";

export function businessHandlers(
	paths: RallyPaths,
	supervisor: Supervisor,
	emit: (channel: string, data: unknown) => void,
) {
	const chat = supervisor.main;
	const publishIdentity = (state: IdentityState) => {
		emit(IpcEvent.identity, state);
		return state;
	};
	const mcp = new McpStore(paths.agentDir);
	const skills = new SkillStore(paths.agentDir);
	const skillProjects = () => [
		paths.mainCwd,
		supervisor.workspace.base(),
		...supervisor.workspace.state().recentProjects,
	];
	const trustState = () =>
		projectTrustState(paths.agentDir, [supervisor.workspace.base(), ...supervisor.workspace.state().recentProjects]);
	return {
		[IpcChannel.credentialsState]: () => supervisor.websiteAccounts.state(),
		[IpcChannel.credentialsSubmit]: (input: unknown) => {
			const result = supervisor.websiteAccounts.submit(input);
			supervisor.relay.notice(`网站账号申请已处理：${JSON.stringify(result)}`, `credential:${result.id}:${result.status}`);
			return supervisor.websiteAccounts.state();
		},
		[IpcChannel.credentialsCancel]: (id: string) => {
			supervisor.websiteAccounts.cancel(id);
			supervisor.relay.notice(`网站账号申请已取消：${id}`, `credential:${id}:cancelled`);
			return supervisor.websiteAccounts.state();
		},
		[IpcChannel.credentialsUpdate]: (id: string, enabled: boolean) => { supervisor.websiteAccounts.update(id, enabled); return supervisor.websiteAccounts.state(); },
		[IpcChannel.credentialsRemove]: (id: string) => { supervisor.websiteAccounts.remove(id); return supervisor.websiteAccounts.state(); },
		[IpcChannel.credentialsReplace]: (id: string, input: unknown) => { supervisor.websiteAccounts.replace(id, input); return supervisor.websiteAccounts.state(); },
		[IpcChannel.credentialsClearLogin]: () => supervisor.agentBrowser.clearLogin(),
		[IpcChannel.toolProvidersState]: () => supervisor.toolProviders.state(),
		[IpcChannel.toolProvidersSave]: (input: unknown) => supervisor.toolProviders.save(input),
		[IpcChannel.qqMailState]: () => supervisor.qqMail.state(),
		[IpcChannel.qqMailSave]: (input: QqMailCredentials) => supervisor.qqMail.save(input),
		[IpcChannel.qqMailVerify]: () => supervisor.qqMail.verify(),
		[IpcChannel.qqMailDisconnect]: () => supervisor.qqMail.disconnect(),
		[IpcChannel.qqBotState]: () => supervisor.qqBot.state(),
		[IpcChannel.qqBotSave]: (input: ImBotCredentials) => supervisor.qqBot.save(input),
		[IpcChannel.qqBotRetry]: () => supervisor.qqBot.start(),
		[IpcChannel.qqBotPair]: () => supervisor.qqBot.pair(),
		[IpcChannel.qqBotDisconnect]: () => supervisor.qqBot.disconnect(),
		[IpcChannel.feishuState]: () => supervisor.feishu.state(),
		[IpcChannel.feishuSave]: (input: FeishuCredentials) => supervisor.feishu.save(input),
		[IpcChannel.feishuRetry]: () => supervisor.feishu.start(),
		[IpcChannel.feishuPair]: () => supervisor.feishu.pair(),
		[IpcChannel.feishuTools]: (enabled: boolean) => supervisor.feishu.setTools(enabled),
		[IpcChannel.feishuDisconnect]: () => supervisor.feishu.disconnect(),
		[IpcChannel.identityState]: () => supervisor.identity.state(),
		[IpcChannel.identityInitialize]: (legacy: unknown) => publishIdentity(supervisor.identity.initialize(legacy)),
		[IpcChannel.identityUpdate]: (patch: unknown) => publishIdentity(supervisor.identity.update(patch)),
		[IpcChannel.identityResetAvatar]: () => publishIdentity(supervisor.identity.setAvatar(null)),
		[IpcChannel.schedulesState]: () => supervisor.schedules.list(),
		[IpcChannel.schedulesUpdate]: (id: string, enabled: boolean | null) => supervisor.schedules.update(id, enabled),
		[IpcChannel.servicesState]: () => supervisor.services.state(),
		[IpcChannel.servicesStop]: async (id: unknown) => {
			if (typeof id !== "string" || !/^S-\d+$/.test(id)) throw new Error("SERVICE_NOT_FOUND");
			await supervisor.services.stop(id, "user");
			return supervisor.services.state();
		},
		[IpcChannel.coachState]: () => supervisor.coachSettings.state(),
		[IpcChannel.coachUpdate]: (patch: unknown) => supervisor.coachSettings.update(patch),
		[IpcChannel.userSeen]: () => supervisor.userSeen(),
		[IpcChannel.memoryState]: () => supervisor.memory.state(),
		[IpcChannel.mcpState]: () => mcp.state(),
		[IpcChannel.mcpSave]: (json: string) => mcp.save(json),
		[IpcChannel.mcpSaveServer]: (name: string, json: string, originalName?: string) =>
			mcp.saveServer(name, json, originalName),
		[IpcChannel.mcpUpdate]: (name: string, enabled: boolean | null) => mcp.update(name, enabled),
		[IpcChannel.mcpTier]: (name: string, tier: McpRiskTier) => mcp.setTier(name, tier),
		[IpcChannel.mcpExposure]: (name: string, exposure: McpExposure | null, tool?: string) => {
			return mcp.setExposure(name, exposure, tool);
		},
		[IpcChannel.gateDecide]: (id: string, decision: "allow" | "deny") => {
			supervisor.gates.decide(id, decision, "user", [], "用户点击确认卡片");
			return supervisor.board();
		},
		[IpcChannel.trustState]: trustState,
		[IpcChannel.trustSet]: (path: string, trusted: boolean) => {
			setProjectTrust(paths.agentDir, path, trusted);
			return trustState();
		},
		[IpcChannel.skillsState]: () => skills.state(skillProjects()),
		[IpcChannel.skillsImport]: async (path: string) => {
			skills.importDirectory(path);
			return skills.state(skillProjects());
		},
		[IpcChannel.skillsEnable]: async (path: string, enabled: boolean) => {
			await skills.setEnabled(path, enabled, skillProjects());
			return skills.state(skillProjects());
		},
		[IpcChannel.chatState]: () => chat.state(),
		[IpcChannel.chatSend]: (text: unknown, attachments?: string[]) => chat.send(typeof text === "string" ? text : "", attachments),
		[IpcChannel.chatAbort]: () => chat.abort(),
		[IpcChannel.chatReset]: () => chat.reset(),
		[IpcChannel.chatNewConversation]: () => chat.newConversation(),
		[IpcChannel.workspaceState]: () => supervisor.workspace.state(),
		[IpcChannel.workspaceUpdate]: (patch: WorkspacePatch) => {
			if (
				!patch ||
				typeof patch !== "object" ||
				Object.keys(patch).some((key) => key !== "defaultWorkspace") ||
				(patch.defaultWorkspace !== undefined && typeof patch.defaultWorkspace !== "string")
			)
				throw new Error("只可设置主对话默认工作区");
			const state = supervisor.workspace.update(patch);
			emit(IpcEvent.workspace, state);
			return state;
		},
		[IpcChannel.tasksState]: () => supervisor.board(),
		[IpcChannel.tasksApprove]: (taskId: unknown) => supervisor.approve(String(taskId)),
		[IpcChannel.tasksCancel]: (taskId: unknown) => supervisor.cancel(String(taskId)),
		[IpcChannel.tasksArchive]: (taskId: string, archived: boolean) => supervisor.archive(taskId, archived),
		[IpcChannel.tasksDelete]: (taskId: unknown) => {
			if (typeof taskId !== "string") throw new Error("无效任务编号");
			return supervisor.deleteArchived(taskId);
		},
		[IpcChannel.tasksAnswerOption]: (taskId: unknown, questionId: unknown, option: unknown) => {
			if (typeof taskId !== "string" || typeof questionId !== "string" || typeof option !== "string")
				throw new Error("ANSWER_INVALID: 回答参数无效");
			return supervisor.answerOption(taskId, questionId, option);
		},
		[IpcChannel.tasksApprovalMode]: (enabled: unknown) => supervisor.setAutoApprove(enabled === true),

		[IpcChannel.modelsState]: () => supervisor.models.state(),
		[IpcChannel.modelsSave]: async (providers: unknown) => {
			const state = await supervisor.models.save(Array.isArray(providers) ? (providers as ProviderEntry[]) : []);
			// Provider edits (URL/key) must reach the live session too, not just the next selection.
			await supervisor.main.reapplyActiveModel();
			return state;
		},
		[IpcChannel.modelsFetch]: (input: unknown) => supervisor.models.fetchModels(input as FetchModelsInput),

		[IpcChannel.modelsSelect]: (input: unknown) => chat.selectModel(input as SelectModelInput),

		[IpcChannel.modelsSelectWorker]: (input: unknown) => supervisor.models.selectWorker(input as SelectModelInput),
	};
}
