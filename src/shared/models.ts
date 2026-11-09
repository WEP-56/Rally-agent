// Rally provider/model config shared by main, preload and renderer (M1-C).
// The authoritative copy is plain JSON under ~/.rally/agent/rally-models.json.

/** Thinking levels Pi understands, in ascending order. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** Wire protocols the UI offers. They are mapped to Pi's `Api` names in the main process. */
export type ProviderProtocol = "messages" | "responses";

/** One model under a provider. Fields beyond id are Rally metadata fed into Pi's model definition. */
export interface ModelEntry {
	id: string;
	/** Display name; falls back to id in the selector. */
	name?: string;
	contextWindow: number;
	/** Fraction of the context window after which Rally should compact (0..1). Stored as metadata. */
	compactionThreshold: number;
	maxTokens: number;
	vision: boolean;
	reasoning: boolean;
	/** Levels this model accepts when the provider needs an explicit declaration; empty means Pi defaults. */
	thinkingLevels: ThinkingLevelName[];
}

export interface ProviderEntry {
	id: string;
	/** Free text; shown as the dim group caption in the model picker. */
	name: string;
	protocol: ProviderProtocol;
	baseUrl: string;
	apiKey: string;
	models: ModelEntry[];
}

/** What the main session currently uses; persisted so a restart picks it up. */
export interface ActiveSelection {
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevelName;
}

/** One registered model, already validated against Pi. Consumed by the grouped model picker. */
export interface ModelSummary {
	provider: string;
	providerName: string;
	id: string;
	name: string;
	reasoning: boolean;
	thinkingLevels: ThinkingLevelName[];
}

/** Provider settings plus what actually registered, and any config errors worth surfacing. */
export interface ModelsState {
	providers: ProviderEntry[];
	available: ModelSummary[];
	active: ActiveSelection | null;
	/** Global worker choice. Read at run start; never changes an already running worker. */
	worker: ActiveSelection | null;
	errors: string[];
	/** Absolute path of the JSON file (shown in settings so the user can find it). */
	file: string;
}

export interface FetchModelsInput {
	protocol: ProviderProtocol;
	baseUrl: string;
	apiKey: string;
}

export type FetchModelsResult = { ok: true; models: string[] } | { ok: false; error: string };

export interface SelectModelInput {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevelName;
}

/** Factory for a fresh model entry when the user adds a model by hand. */
export function defaultModel(id: string): ModelEntry {
	return {
		id,
		contextWindow: 128000,
		compactionThreshold: 0.8,
		maxTokens: 16384,
		vision: false,
		reasoning: false,
		thinkingLevels: [],
	};
}
