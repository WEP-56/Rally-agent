// Renderer mirror of the main-process provider/model config (M1-C).
// A module-level cache keeps the settings page and the composer picker consistent
// without each component refetching over IPC.

import { useCallback, useEffect, useState } from "react";
import type {
	FetchModelsInput,
	FetchModelsResult,
	ModelsState,
	ProviderEntry,
	SelectModelInput,
} from "../../shared/models";

let cache: ModelsState | null = null;
const listeners = new Set<(state: ModelsState) => void>();

function publish(state: ModelsState): void {
	cache = state;
	for (const listener of listeners) listener(state);
}

async function reload(): Promise<ModelsState> {
	const state = await window.rally.models.getState();
	publish(state);
	return state;
}

export interface ModelsController {
	state: ModelsState | null;
	save(providers: ProviderEntry[]): Promise<ModelsState>;
	fetchModels(input: FetchModelsInput): Promise<FetchModelsResult>;
	select(input: SelectModelInput): Promise<void>;
	selectWorker(input: SelectModelInput): Promise<void>;
	reload(): Promise<ModelsState>;
}

export function useModels(): ModelsController {
	const [state, setState] = useState<ModelsState | null>(cache);

	useEffect(() => {
		// Every mounted consumer subscribes to one cache so a save in settings refreshes the picker.
		const listener = (next: ModelsState) => setState(next);
		listeners.add(listener);
		if (cache === null) {
			void reload().catch((error: unknown) => console.error("models.getState failed", error));
		}
		return () => {
			listeners.delete(listener);
		};
	}, []);

	const save = useCallback(async (providers: ProviderEntry[]) => {
		const next = await window.rally.models.save(providers);
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
