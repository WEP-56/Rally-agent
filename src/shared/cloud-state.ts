import { IpcChannel as C, IpcEvent, type ChatEvent, type ChatState, type TaskEvent } from "./ipc.ts";
import { questionViews, type TaskBoard } from "./task.ts";

export interface CloudEvents {
	epoch: string;
	seq: number;
	events: { channel: string; data: unknown }[];
}

export function applyChat(state: ChatState, event: ChatEvent): ChatState {
	if (event.type === "snapshot") return event.state;
	if (event.type === "busy") return { ...state, busy: event.busy };
	if (event.type === "header") return { ...state, header: event.header };
	const message = event.message;
	const found = state.messages.some((line) => line.id === message.id);
	return {
		...state,
		messages: found
			? state.messages.map((line) => (line.id === message.id ? message : line))
			: [...state.messages, message],
	};
}

export function applyTask(current: TaskBoard, event: TaskEvent): TaskBoard {
	if (event.type !== "task") return event.board;
	const exists = current.tasks.some((task) => task.id === event.task.id);
	const tasks = exists
		? current.tasks.map((task) => (task.id === event.task.id ? event.task : task))
		: [...current.tasks, event.task];
	const open = tasks.filter((task) => !task.ended && task.archivedAt === undefined);
	const ended = tasks
		.filter((task) => task.ended && task.archivedAt === undefined)
		.sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id.slice(2)) - Number(a.id.slice(2)))
		.slice(0, 20);
	const archived = tasks.filter((task) => task.archivedAt !== undefined);
	const questions = [
		...(current.questions ?? []).filter((item) => item.taskId !== event.task.id),
		...questionViews(event.task),
	];
	return { ...current, tasks: [...open, ...ended, ...archived], questions };
}

const snapshotChannels = [C.chatState, C.tasksState, C.identityState, C.workspaceState, C.servicesState];
const allowed = new Set<string>([...snapshotChannels, C.modelsState, C.memoryState]);
const eventChannel = new Map<string, string>([
	[IpcEvent.identity, C.identityState],
	[IpcEvent.workspace, C.workspaceState],
	[IpcEvent.services, C.servicesState],
]);
const limit = 4 * 1024 * 1024; // At most 8 MiB of UTF-16 text per server profile.

/** A bounded, disposable read model. The server remains authoritative; credentials never enter this cache. */
export class CloudMirror {
	readonly scope: string;
	epoch = "";
	seq = 0;
	private states: Record<string, unknown> = {};
	constructor(url: string, instance: string) {
		this.scope = JSON.stringify([url, instance]);
	}
	get complete(): boolean {
		return snapshotChannels.every((channel) => Object.hasOwn(this.states, channel));
	}
	read<T>(channel: string): T | undefined {
		return this.states[channel === C.identityInitialize ? C.identityState : channel] as T | undefined;
	}
	remember(channel: string, value: unknown): void {
		if (!allowed.has(channel)) return;
		if (channel === C.modelsState) {
			// Only accept the cloud API's masked provider keys, never local credentials or form drafts.
			const providers = (value as { providers?: { apiKey: string }[] })?.providers;
			if (!Array.isArray(providers) || providers.some((p) => p.apiKey && !p.apiKey.startsWith("已保存:"))) return;
		}
		this.states[channel] = value;
	}
	apply(packet: CloudEvents): void {
		for (const { channel, data } of packet.events) {
			if (channel === IpcEvent.chat) {
				const event = data as ChatEvent;
				const current = this.read<ChatState>(C.chatState);
				if (event.type === "snapshot") this.remember(C.chatState, event.state);
				else if (current) this.remember(C.chatState, applyChat(current, event));
			} else if (channel === IpcEvent.task) {
				const event = data as TaskEvent;
				const current = this.read<TaskBoard>(C.tasksState);
				if (event.type !== "task") this.remember(C.tasksState, event.board);
				else if (current) this.remember(C.tasksState, applyTask(current, event));
			} else {
				const stateChannel = eventChannel.get(channel);
				if (stateChannel) this.remember(stateChannel, data);
			}
		}
		// Cursor and applied state are always stored together, including deletion and conversation reset.
		this.epoch = this.complete ? packet.epoch : "";
		this.seq = this.complete ? packet.seq : 0;
	}
	encode(): string {
		let states = this.states;
		let record = JSON.stringify({ version: 1, scope: this.scope, epoch: this.epoch, seq: this.seq, states });
		if (record.length > limit) {
			// Keep the small identity/preferences preview, but discard the cursor with the large history.
			states = Object.fromEntries(
				[C.identityState, C.memoryState]
					.filter((key) => Object.hasOwn(this.states, key))
					.map((key) => [key, this.states[key]]),
			);
			record = JSON.stringify({ version: 1, scope: this.scope, epoch: "", seq: 0, states });
		}
		return record.length <= limit ? record : "";
	}
	restore(text: unknown): boolean {
		try {
			if (typeof text !== "string" || text.length > limit) return false;
			const value = JSON.parse(text);
			if (
				value.version !== 1 ||
				value.scope !== this.scope ||
				typeof value.epoch !== "string" ||
				!Number.isSafeInteger(value.seq) ||
				value.seq < 0 ||
				!value.states ||
				Array.isArray(value.states)
			)
				return false;
			const chat = value.states[C.chatState],
				board = value.states[C.tasksState],
				identity = value.states[C.identityState];
			if (chat && (!Array.isArray(chat.messages) || !chat.header || !Array.isArray(chat.thinkingLevels)))
				return false;
			if (board && !Array.isArray(board.tasks)) return false;
			if (
				identity &&
				(typeof identity.name !== "string" ||
					typeof identity.personality !== "string" ||
					typeof identity.workstyle !== "string")
			)
				return false;
			for (const [key, state] of Object.entries(value.states)) this.remember(key, state);
			if (this.complete) {
				this.epoch = value.epoch;
				this.seq = value.seq;
			}
			return Object.keys(this.states).length > 0;
		} catch {
			return false;
		}
	}
}
