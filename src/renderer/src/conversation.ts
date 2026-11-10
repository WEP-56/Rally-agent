import type { TaskQuestionView } from "../../shared/task";
import type { ChatMsg } from "./data";

export type ConversationItem = ChatMsg | { id: string; role: "question"; at: number; record: TaskQuestionView };

/** Join provider turns for display only; persisted messages and quote IDs stay intact. */
export function conversationItems(messages: ChatMsg[], questions: TaskQuestionView[] = []): ConversationItem[] {
	const history: ConversationItem[] = [...messages, ...questions.filter(({ question }) => question.answer || question.closed).map(record => ({
		id: `question-${record.question.id}`, role: "question" as const,
		at: record.question.answer?.at ?? record.question.closed!.at, record,
	}))].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
	const result: ConversationItem[] = [];
	for (const item of history) {
		const previous = result.at(-1);
		if (item.role === "assistant" && previous?.role === "assistant" && item.runId === previous.runId && !item.taskRef && !previous.taskRef && !item.steps?.length && !previous.steps?.length) {
			result[result.length - 1] = { ...previous, text: previous.text + "\n\n" + item.text,
				blocks: [...blocksOf(previous), ...blocksOf(item)], toolCalls: [...(previous.toolCalls ?? []), ...(item.toolCalls ?? [])], streaming: item.streaming };
		} else result.push(item);
	}
	return result;
}

function blocksOf(message: ChatMsg) {
	return message.blocks?.length ? message.blocks : [
		...(message.toolCalls ?? []).map(call => ({ type: "tool" as const, toolCallId: call.id })),
		...(message.text.trim() ? [{ type: "text" as const, text: message.text }] : []),
	];
}
