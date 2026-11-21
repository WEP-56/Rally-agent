// Renderer-side mirror of the main conversation. Main owns the truth; this only applies pushed updates.

import { useCallback, useEffect, useState } from "react";
import type { ChatLine, ChatState } from "../../shared/ipc";
import type { ThinkingLevelName } from "../../shared/models";
import { IpcChannel } from "../../shared/ipc";
import { applyChat } from "../../shared/cloud-state";
import { cloudRead } from "./cloud-cache";

const EMPTY: ChatState = {
	messages: [],
	header: { activity: null, showCompact: false, showNewConversation: false },
	busy: false,
	model: null,
	thinkingLevel: null,
	thinkingLevels: [],
	notice: null,
};

export interface ChatController {
	messages: ChatLine[];
	header: ChatState["header"];
	conversation?: ChatState["conversation"];
	busy: boolean;
	model: string | null;
	thinkingLevel: string | null;
	thinkingLevels: string[];
	notice: string | null;
	send(text: string, attachments?: string[]): Promise<void>;
	abort(): void;
	reset(): Promise<boolean>;
	newConversation(): Promise<void>;
	selectModel(provider: string, model: string, level?: ThinkingLevelName): void;
}

export function useChat(): ChatController {
	const [state, setState] = useState<ChatState>(() => cloudRead<ChatState>(IpcChannel.chatState) ?? EMPTY);

	useEffect(() => {
		let alive = true;
		let snapshotReceived = false;
		const unsubscribe = window.rally.chat.onEvent((event) => {
			if (event.type === "snapshot") snapshotReceived = true;
			if (alive) setState((current) => applyChat(current, event));
		});
		void window.rally.chat.getState().then((snapshot) => {
			if (alive && !snapshotReceived) setState(snapshot);
		}).catch(() => {});
		return () => {
			alive = false;
			unsubscribe();
		};
	}, []);

	// The backend records failures as system lines, so these only guard IPC transport errors.
	const send = useCallback((text: string, attachments?: string[]) => {
		return window.rally.chat.send(text, attachments);
	}, []);
	const abort = useCallback(() => {
		void window.rally.chat.abort().catch((error: unknown) => console.error("chat.abort failed", error));
	}, []);
	const reset = useCallback(() => {
		return window.rally.chat.reset();
	}, []);
	// Model switching is main-owned; the returned snapshot already reflects the new session state.
	const selectModel = useCallback((provider: string, model: string, level?: ThinkingLevelName) => {
		void window.rally.models
			.select({ provider, model, thinkingLevel: level })
			.then((snapshot) => setState(snapshot))
			.catch((error: unknown) => console.error("models.select failed", error));
	}, []);

	return { ...state, send, abort, reset, selectModel, newConversation: window.rally.chat.newConversation };
}
