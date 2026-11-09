// Renderer-side mirror of the main conversation. Main owns the truth; this only applies pushed updates.

import { useCallback, useEffect, useState } from "react";
import type { ChatEvent, ChatLine, ChatState } from "../../shared/ipc";
import type { ThinkingLevelName } from "../../shared/models";

const EMPTY: ChatState = {
	messages: [],
	busy: false,
	model: null,
	thinkingLevel: null,
	thinkingLevels: [],
	notice: null,
};

export interface ChatController {
	messages: ChatLine[];
	busy: boolean;
	model: string | null;
	thinkingLevel: string | null;
	thinkingLevels: string[];
	notice: string | null;
	send(text: string): void;
	abort(): void;
	reset(): void;
	selectModel(provider: string, model: string, level?: ThinkingLevelName): void;
}

export function useChat(): ChatController {
	const [state, setState] = useState<ChatState>(EMPTY);

	useEffect(() => {
		let alive = true;
		const unsubscribe = window.rally.chat.onEvent((event) => {
			if (alive) setState((current) => apply(current, event));
		});
		void window.rally.chat.getState().then((snapshot) => {
			if (alive) setState(snapshot);
		});
		return () => {
			alive = false;
			unsubscribe();
		};
	}, []);

	// The backend records failures as system lines, so these only guard IPC transport errors.
	const send = useCallback((text: string) => {
		void window.rally.chat.send(text).catch((error: unknown) => console.error("chat.send failed", error));
	}, []);
	const abort = useCallback(() => {
		void window.rally.chat.abort().catch((error: unknown) => console.error("chat.abort failed", error));
	}, []);
	const reset = useCallback(() => {
		void window.rally.chat.reset().catch((error: unknown) => console.error("chat.reset failed", error));
	}, []);
	// Model switching is main-owned; the returned snapshot already reflects the new session state.
	const selectModel = useCallback((provider: string, model: string, level?: ThinkingLevelName) => {
		void window.rally.models
			.select({ provider, model, thinkingLevel: level })
			.then((snapshot) => setState(snapshot))
			.catch((error: unknown) => console.error("models.select failed", error));
	}, []);

	return { ...state, send, abort, reset, selectModel };
}

function apply(state: ChatState, event: ChatEvent): ChatState {
	if (event.type === "snapshot") return event.state;
	if (event.type === "busy") return { ...state, busy: event.busy };
	const message = event.message;
	const index = state.messages.findIndex((line) => line.id === message.id);
	const messages =
		index === -1 ? [...state.messages, message] : state.messages.map((line, i) => (i === index ? message : line));
	return { ...state, messages };
}
