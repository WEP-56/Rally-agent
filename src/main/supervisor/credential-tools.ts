import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { WebsiteAccounts } from "../website-accounts.ts";
import type { TaskStore } from "./task-store.ts";

export function createCredentialRequestTool(accounts: WebsiteAccounts, tasks: TaskStore): ToolDefinition {
	const parameters = Type.Object({ website: Type.String({ minLength: 1, maxLength: 16384 }), purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })), taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, { additionalProperties: false });
	return {
		name: "credential_request", label: "申请网站账号", parameters,
		description: "Ask the user to save a website account through Rally's private credential form. Pass the exact HTTP(S) website origin, optionally purpose and the related taskId. Requests expire after 24 hours or when their associated task/run ends. Never ask for account names or passwords in chat. Returns only request metadata; saving or cancelling automatically resumes you with a credential_result event. Continue from that result without asking the user to confirm saving in chat. Enabled saved accounts can be reused by Workers on the matching website; saving does not mean website login has succeeded. Browser control belongs to Workers.",
		execute: async (id, input: Static<typeof parameters>, signal) => {
			signal?.throwIfAborted();
			const task = input.taskId ? tasks.get(input.taskId) : undefined;
			if (input.taskId && (!task || task.ended)) throw Error("关联任务不存在或已结束");
			const details = accounts.request(id, input.website, { purpose: input.purpose, taskId: task?.id, runId: task?.runs.at(-1)?.id });
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	};
}
