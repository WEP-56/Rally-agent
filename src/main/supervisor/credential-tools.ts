import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { WebsiteAccounts } from "../website-accounts.ts";
import type { TaskStore } from "./task-store.ts";

export function createCredentialRequestTool(accounts: WebsiteAccounts, tasks: TaskStore): ToolDefinition {
	const parameters = Type.Object({ service: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })), website: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })), kind: Type.Optional(Type.Union([Type.Literal("account"), Type.Literal("secret")])), label: Type.Optional(Type.String({ maxLength: 200 })), purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })), taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, { additionalProperties: false });
	return {
		name: "credential_request", label: "申请账号或密钥", parameters,
		description: "Ask the user to save a credential in Rally's private password book for any task: browser, CLI, API, database or other service. Pass service (a public service name or HTTP(S) origin; website is a legacy alias), kind=account for username/password or kind=secret for a token/API key without username, and optionally a public label, purpose and taskId. Use the exact HTTP(S) origin for browser login. Never put secret values in these fields or ask for them in chat. First check credential_list to reuse an enabled entry; do not guess between identities. Returns metadata only. Requests expire after 24 hours or when their associated task/run ends. Saving/cancelling resumes you with credential_result; continue without asking the user to confirm again. Workers use credentialEnv for commands/services/Git/GitHub, credential placeholders in HTTP headers/body, or browser_login for matching website accounts. Saving does not confirm authentication succeeded.",
		execute: async (id, input: Static<typeof parameters>, signal) => {
			signal?.throwIfAborted();
			const task = input.taskId ? tasks.get(input.taskId) : undefined;
			if (input.taskId && (!task || task.ended)) throw Error("关联任务不存在或已结束");
			if (!input.service && !input.website) throw Error("请提供服务名称或网站地址");
			if (input.service && input.website && input.service !== input.website) throw Error("service 与 website 不能指向不同服务");
			const details = accounts.request(id, input.service ?? input.website!, { kind: input.kind, label: input.label, purpose: input.purpose, taskId: task?.id, runId: task?.runs.at(-1)?.id });
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	};
}

export function createCredentialListTool(accounts: WebsiteAccounts): ToolDefinition {
	const parameters = Type.Object({ service: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })) }, { additionalProperties: false });
	return {
		name: "credential_list", label: "查询密码本", parameters,
		description: "List enabled credentials usable across Rally tasks. Optional service filters the public service/origin or label (case-insensitive substring). Returns IDs, service/origin, label and kind, never usernames/passwords/tokens. For bash/powershell/git/github/service_start pass credentialEnv:{ENV_NAME:{id,field:'secret'}} (or field:'username' for an account). For http_request headers/body use {{credential:ID:secret}} or {{credential:ID:username}}, e.g. Authorization: Bearer {{credential:ID:secret}}. Browser login still requires an exact matching website account. If none match, the main agent uses credential_request and a Worker reports the missing service/kind to the main agent. If identity is ambiguous, ask the user to choose. Credential access does not authorize mutations or bypass approval gates.",
		execute: async (_id, input: Static<typeof parameters>, signal) => {
			signal?.throwIfAborted();
			const query = input.service?.toLowerCase();
			const details = { credentials: accounts.state().accounts.filter(account => account.enabled && (!query || account.origin.toLowerCase().includes(query) || account.label?.toLowerCase().includes(query))) };
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	};
}
