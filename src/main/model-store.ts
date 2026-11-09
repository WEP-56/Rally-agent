// Rally's own provider/model config: plain JSON under ~/.rally/agent/rally-models.json.
// Providers are registered into Pi's ModelRuntime, so all HTTP protocol work stays in @rally/ai.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Api, getSupportedThinkingLevels, type Model } from "@rally/ai";
import { ModelRuntime } from "@rally/coding-agent";
import {
	type ActiveSelection,
	type FetchModelsInput,
	type FetchModelsResult,
	type ModelEntry,
	type ModelSummary,
	type ModelsState,
	type ProviderEntry,
	type ProviderProtocol,
	type SelectModelInput,
	type ThinkingLevelName,
	THINKING_LEVELS,
	defaultModel,
} from "../shared/models.ts";

/** On-disk shape. Kept close to Pi's models.json so the file is easy to read by hand. */
interface FileShape {
	version: 1;
	active: ActiveSelection | null;
	worker: ActiveSelection | null;
	providers: ProviderEntry[];
}

const REASONING_HEADER = "anthropic-version";
const REQUEST_TIMEOUT_MS = 10000;

/** Map the two UI protocols onto Pi's wire APIs. */
function apiFor(protocol: ProviderProtocol): "anthropic-messages" | "openai-responses" {
	return protocol === "messages" ? "anthropic-messages" : "openai-responses";
}

/** A user-declared level list becomes an explicit Pi thinkingLevelMap; empty means Pi defaults. */
function thinkingMap(entry: ModelEntry): Partial<Record<ThinkingLevelName, string | null>> | undefined {
	if (!entry.reasoning || entry.thinkingLevels.length === 0) return undefined;
	const map: Partial<Record<ThinkingLevelName, string | null>> = {};
	// "off" is always offered, otherwise a model could never be told to stop thinking.
	for (const level of THINKING_LEVELS) map[level] = level === "off" || entry.thinkingLevels.includes(level) ? level : null;
	return map;
}

/** Keep numeric metadata sane before it reaches Pi (which throws on non-positive limits). */
function normalizeModel(entry: ModelEntry): ModelEntry {
	const id = String(entry.id ?? "").trim();
	return {
		...entry,
		id,
		name: entry.name?.trim() || undefined,
		contextWindow: positive(entry.contextWindow, 128000),
		compactionThreshold: Math.min(1, Math.max(0, Number(entry.compactionThreshold) || 0.8)),
		maxTokens: positive(entry.maxTokens, 16384),
		vision: Boolean(entry.vision),
		reasoning: Boolean(entry.reasoning),
		thinkingLevels: (Array.isArray(entry.thinkingLevels) ? entry.thinkingLevels : []).filter((level): level is ThinkingLevelName =>
			(THINKING_LEVELS as readonly string[]).includes(level),
		),
	};
}

function positive(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Providers come from the renderer, so coerce instead of trusting shapes. */
function normalizeProvider(input: ProviderEntry): ProviderEntry {
	return {
		id: String(input.id ?? "").trim(),
		name: String(input.name ?? "").trim(),
		protocol: input.protocol === "responses" ? "responses" : "messages",
		baseUrl: String(input.baseUrl ?? "").trim(),
		apiKey: String(input.apiKey ?? ""),
		models: Array.isArray(input.models) ? input.models.map(normalizeModel) : [],
	};
}

export class ModelStore {
	private readonly file: string;
	private providers: ProviderEntry[] = [];
	private active: ActiveSelection | null = null;
	private worker: ActiveSelection | null = null;
	private errors: string[] = [];
	private loadErrors: string[] = [];
	private runtime: ModelRuntime | null = null;
	private initialized: Promise<void>;

	constructor(file: string) {
		this.file = file;
		this.load();
		this.initialized = this.init();
	}

	/** Resolve once Pi's runtime exists and the saved providers are registered. */
	async whenReady(): Promise<ModelRuntime | null> {
		await this.initialized;
		return this.runtime;
	}

	async state(): Promise<ModelsState> {
		await this.initialized;
		return this.snapshot();
	}

	/** Replace the provider list, persist it, then re-register everything with Pi. */
	async save(input: unknown): Promise<ModelsState> {
		await this.initialized;
		const providers = Array.isArray(input) ? input.map((entry) => normalizeProvider(entry as ProviderEntry)) : [];
		this.providers = providers;
		this.registerAll();
		// A deleted/renamed model must not stay "active"; the renderer will prompt for a new pick.
		if (this.active && !this.runtime?.getModel(this.active.provider, this.active.model)) {
			this.active = null;
		}
		if (this.worker && !this.runtime?.getModel(this.worker.provider, this.worker.model)) this.worker = null;
		this.persist();
		return this.snapshot();
	}

	/** The persisted main-session choice, or null. */
	get activeSelection(): ActiveSelection | null {
		return this.active;
	}

	/** Persist a successful switch; MainAgent owns the live session. */
	setActive(selection: ActiveSelection): void {
		this.active = this.validateSelection(selection);
		this.persist();
	}

	async selectWorker(input: SelectModelInput): Promise<ModelsState> {
		await this.initialized;
		this.worker = this.validateSelection({ ...input, thinkingLevel: input.thinkingLevel ?? "off" });
		this.persist();
		return this.snapshot();
	}

	private validateSelection(selection: ActiveSelection): ActiveSelection {
		const model = this.resolve(selection.provider, selection.model);
		if (!model) throw new Error(`找不到模型 ${selection.provider}/${selection.model}，请先保存供应商配置`);
		const levels = getSupportedThinkingLevels(model);
		if (!levels.includes(selection.thinkingLevel)) throw new Error(`该模型不支持思考档位 ${selection.thinkingLevel}`);
		return { ...selection };
	}

	/** Model + level to restore at startup, or null when nothing valid is saved. */
	selection(role: "main" | "worker" = "main"): { model: Model<Api>; thinkingLevel: ThinkingLevelName } | null {
		const selected = role === "worker" ? this.worker : this.active;
		if (!this.runtime || !selected) return null;
		const model = this.runtime.getModel(selected.provider, selected.model);
		if (!model) return null;
		const levels = getSupportedThinkingLevels(model);
		return { model, thinkingLevel: levels.includes(selected.thinkingLevel) ? selected.thinkingLevel : "off" };
	}

	resolve(providerId: string, modelId: string): Model<Api> | undefined {
		return this.runtime?.getModel(providerId, modelId);
	}

	/** Pi's own view of a model's levels; used for the picker's second panel. */
	levelsFor(providerId: string, modelId: string): ThinkingLevelName[] {
		const model = this.runtime?.getModel(providerId, modelId);
		return model ? (getSupportedThinkingLevels(model) as ThinkingLevelName[]) : [];
	}

	/** Ask the provider's model-list endpoint. Errors are returned as text for the settings UI. */
	async fetchModels(input: FetchModelsInput): Promise<FetchModelsResult> {
		const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/u, "");
		if (!/^https?:\/\//u.test(baseUrl)) return { ok: false, error: "Base URL 必须以 http:// 或 https:// 开头" };
		const apiKey = String(input.apiKey ?? "").trim();
		const protocol: ProviderProtocol = input.protocol === "responses" ? "responses" : "messages";
		const headers: Record<string, string> =
			protocol === "messages"
				? { [REASONING_HEADER]: "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) }
				: apiKey
					? { Authorization: `Bearer ${apiKey}` }
					: {};
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal });
			if (!response.ok) return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() };
			const body: unknown = await response.json();
			const list = Array.isArray(body)
				? body
				: Array.isArray((body as { data?: unknown })?.data)
					? ((body as { data: unknown[] }).data as unknown[])
					: Array.isArray((body as { models?: unknown })?.models)
						? ((body as { models: unknown[] }).models as unknown[])
						: [];
			const ids = list
				.map((item) =>
					typeof item === "string"
						? item
						: ((item as { id?: unknown; name?: unknown })?.id ?? (item as { name?: unknown })?.name),
				)
				.map((id) => (typeof id === "string" ? id.trim() : ""))
				.filter((id) => id.length > 0);
			if (ids.length === 0) return { ok: false, error: "接口没有返回任何模型" };
			return { ok: true, models: [...new Set(ids)].slice(0, 200) };
		} catch (error) {
			if (controller.signal.aborted) return { ok: false, error: `请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）` };
			const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
			const detail = cause?.message ?? (error instanceof Error ? error.message : String(error));
			return { ok: false, error: `连接失败：${detail}` };
		} finally {
			clearTimeout(timer);
		}
	}

	private async init(): Promise<void> {
		try {
			this.runtime = await ModelRuntime.create({
				// auth.json stays Pi's; models come from Rally's own file, never ~/.rally/agent/models.json.
				authPath: join(dirname(this.file), "auth.json"),
				modelsPath: null,
			});
			this.registerAll();
		} catch (error) {
			this.errors.push(`模型运行时启动失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private registerAll(): void {
		const runtime = this.runtime;
		if (!runtime) return;
		this.errors = [];
		const wanted = new Set<string>();
		for (const provider of this.providers) {
			if (!provider.id) {
				this.errors.push("有一个供应商缺少 id，已跳过");
				continue;
			}
			if (!/^https?:\/\//u.test(provider.baseUrl)) {
				this.errors.push(`供应商 "${provider.name || provider.id}"：Base URL 必须以 http:// 或 https:// 开头`);
				continue;
			}
			const api = apiFor(provider.protocol);
			const models = provider.models.filter((model) => model.id.length > 0);
			const dropped = provider.models.length - models.length;
			if (dropped > 0) this.errors.push(`供应商 "${provider.name || provider.id}"：${dropped} 个模型缺少 id，已跳过`);
			if (models.length === 0) {
				// Registered with no models so the provider itself stays known, but nothing to select.
				// Pi requires at least one model to compose the provider, so skip registration entirely.
				this.errors.push(`供应商 "${provider.name || provider.id}"：还没有模型`);
				continue;
			}
			try {
				runtime.registerProvider(provider.id, {
					name: provider.name || provider.id,
					baseUrl: provider.baseUrl,
					apiKey: provider.apiKey,
					api,
					models: models.map((model) => ({
						type: "chat" as const,
						id: model.id,
						name: model.name || model.id,
						api,
						reasoning: model.reasoning,
						thinkingLevelMap: thinkingMap(model),
						input: (model.vision ? ["text", "image"] : ["text"]) as ("text" | "image")[],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: model.contextWindow,
						maxTokens: model.maxTokens,
					})),
				});
				wanted.add(provider.id);
			} catch (error) {
				this.errors.push(`供应商 "${provider.name || provider.id}"：${error instanceof Error ? error.message : String(error)}`);
			}
		}
		for (const providerId of runtime.getRegisteredProviderIds()) {
			if (!wanted.has(providerId)) runtime.unregisterProvider(providerId);
		}
	}

	private snapshot(): ModelsState {
		const available: ModelSummary[] = [];
		for (const provider of this.providers) {
			for (const entry of provider.models) {
				const model = this.runtime?.getModel(provider.id, entry.id);
				if (!model) continue;
				available.push({
					provider: provider.id,
					providerName: provider.name || provider.id,
					id: entry.id,
					name: entry.name || entry.id,
					reasoning: Boolean(model.reasoning),
					thinkingLevels: getSupportedThinkingLevels(model) as ThinkingLevelName[],
				});
			}
		}
		return {
			providers: this.providers.map((provider) => ({ ...provider, models: provider.models.map((m) => ({ ...m })) })),
			available,
			active: this.active,
			worker: this.worker,
			errors: [...this.loadErrors, ...this.errors],
			file: this.file,
		};
	}

	private load(): void {
		try {
			const raw = readFileSync(this.file, "utf8");
			const parsed = JSON.parse(raw) as Partial<FileShape>;
			this.providers = Array.isArray(parsed.providers) ? parsed.providers.map(normalizeProvider) : [];
			this.active = parsed.active ?? null;
			this.worker = parsed.worker ?? null;
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
				this.loadErrors.push(`读取 ${this.file} 失败：${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	private persist(): void {
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			const data: FileShape = { version: 1, active: this.active, worker: this.worker, providers: this.providers };
			writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
		} catch (error) {
			this.errors.push(`写入 ${this.file} 失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

/** Re-export for the renderer-facing defaults used by settings cards. */
export { defaultModel };
