// Renderer mirror of the main-process provider/model config (M1-C).
// A module-level cache keeps the settings page and the composer picker consistent
// without each component refetching over IPC.

import { useCallback, useEffect, useState } from "react";
import { IpcChannel } from "../../shared/ipc";
import { cloudRead } from "./cloud-cache";
import type {
	FetchModelsInput,
	FetchModelsResult,
	ModelsState,
	ProviderEntry,
	SelectModelInput,
} from "../../shared/models";

let cache: ModelsState | null = null;
const listeners = new Set<(state: ModelsState) => void>();
let pending: Promise<ModelsState> | undefined;

function publish(state: ModelsState): void {
	cache = state;
	for (const listener of listeners) listener(state);
}

async function reload(): Promise<ModelsState> {
	if (pending) return pending;
	pending = window.rally.models.getState().then(state => { publish(state); return state; });
	try { return await pending; } finally { pending = undefined; }
}

export interface ModelsController {
	state: ModelsState | null;
	save(providers: ProviderEntry[], revision?: string): Promise<ModelsState>;
	fetchModels(input: FetchModelsInput): Promise<FetchModelsResult>;
	select(input: SelectModelInput): Promise<void>;
	selectWorker(input: SelectModelInput): Promise<void>;
	reload(): Promise<ModelsState>;
}

export function useModels(): ModelsController {
	cache ??= cloudRead<ModelsState>(IpcChannel.modelsState) ?? null;
	const [state, setState] = useState<ModelsState | null>(cache);

	useEffect(() => {
		// Every mounted consumer subscribes to one cache so a save in settings refreshes the picker.
		const listener = (next: ModelsState) => setState(next);
		listeners.add(listener);
		const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === "models") void reload().catch(() => {}); };
		window.addEventListener("rally-configuration", changed);
		if (cache === null) {
			void reload().catch((error: unknown) => console.error("models.getState failed", error));
		}
		return () => {
			listeners.delete(listener);
			window.removeEventListener("rally-configuration", changed);
		};
	}, []);

	const save = useCallback(async (providers: ProviderEntry[], revision?: string) => {
		const next = await window.rally.models.save(providers, revision);
		publish(next);
		return next;
	}, []);

	const fetchModels = useCallback((input: FetchModelsInput) => window.rally.models.fetchModels(input), []);

	const select = useCallback(async (input: SelectModelInput) => {
		await window.rally.models.select(input);
		await reload();
	}, []);

	const selectWorker = useCallback(async (input: SelectModelInput) => {
		publish(await window.rally.models.selectWorker(input));
	}, []);

	return { state, save, fetchModels, select, selectWorker, reload };
}
