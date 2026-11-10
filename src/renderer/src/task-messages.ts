import type { TaskView } from "../../shared/task";
import type { ChatMsg, TaskMsg } from "./data";
import { conversationItems } from "./conversation";

export function messagesOf(view: TaskView): TaskMsg[] {
	const messages: TaskMsg[] = view.quotes.map(quote => ({ role: "rally", text: quote.text }));
	if (view.note) messages.push({ role: "rally", text: `主 agent 备注：${view.note}` });
	const inputs = (view.inputs ?? []).filter(input => ["steer", "resume", "answer"].includes(input.kind));
	const transcript: ChatMsg[] = [
		...inputs.map(input => ({ id: `input-${input.id}`, role: "user" as const, at: input.at,
			text: [...(input.quotes ?? []).map(quote => quote.text), ...(input.note ? [`主 agent 备注：${input.note}`] : []), ...(input.body ? [input.body] : [])].join("\n\n") })),
		...(view.assistantMessages ?? []).map(message => ({ ...message, role: "assistant" as const })),
	];
	for (const message of conversationItems(transcript)) {
		if (message.role === "assistant" && (message.blocks?.length || message.streaming)) {
			messages.push({ role: "assistant", message: { ...message, at: message.at ?? 0, runId: message.runId ?? "", blocks: message.blocks ?? [], streaming: Boolean(message.streaming) } });
		} else if (message.role === "user") {
			const input = inputs.find(input => `input-${input.id}` === message.id)!;
			const kind = input.kind === "resume" ? "续接任务" : input.kind === "answer" ? "回答问题" : "追加指令";
			const status = input.readAt ? "已读取" : input.deliveredAt ? "已投递" : "待投递";
			messages.push({ role: "rally", id: message.id, text: message.text, label: `${kind} · ${status}` });
		}
	}
	if (!view.assistantMessages?.length && view.lastReport) messages.push({ role: "agent", text: `${view.lastReport.state}：${view.lastReport.summary}` });
	if (view.changedFiles?.length) messages.push({ role: "agent", text: `改动文件：${view.changedFiles.join(", ")}` });
	return messages;
}
