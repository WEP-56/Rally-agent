import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	SEARCH_PROVIDERS,
	type ImageProvider,
	type ImageSelection,
	type SearchProviderId,
	type ToolProviderPreferences,
	type ToolProviderState,
} from "../shared/tool-providers.ts";
import type { CredentialVault } from "./credential-vault.ts";

interface SavedImage extends ImageProvider { secret: string }
interface SavedSearch { id: SearchProviderId; secret: string }
interface Saved extends ToolProviderPreferences { version: 1; images: SavedImage[]; search: SavedSearch[] }
const empty = (): Saved => ({ version: 1, images: [], search: [], preferredImage: null, preferredSearch: null });

export class ToolProviderError extends Error {
	readonly conflict: boolean;
	constructor(message: string, conflict = false) { super(message); this.conflict = conflict; }
}

function invalid(message: string): never { throw new ToolProviderError(message); }
function requiredString(value: unknown, length: number, label: string) {
	if (typeof value !== "string" || !value.trim() || value.length > length) invalid(`${label}无效`);
	return value.trim();
}
function row(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid("提供商配置格式无效");
	return value as Record<string, unknown>;
}
function list(value: unknown, max: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length > max) invalid(`${label}最多可配置 ${max} 项`);
	return value;
}
function searchId(value: unknown): SearchProviderId {
	if (typeof value !== "string" || !Object.hasOwn(SEARCH_PROVIDERS, value)) invalid("不支持此搜索提供商");
	return value as SearchProviderId;
}
function endpoint(value: unknown): string {
	let url: URL;
	try { url = new URL(requiredString(value, 1000, "图像 API 地址")); }
	catch { invalid("请输入有效的图像 API 地址（HTTP 或 HTTPS）"); }
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.href.includes("?") || url.href.includes("#")) invalid("图像 API 地址不能包含凭据、查询参数或片段");
	const path = url.pathname.replace(/\/+$/, "");
	if (path.endsWith("/images/generations")) invalid("请填写 API 基础地址，不含 /images/generations");
	return url.origin + path;
}

function normalize(input: Record<string, unknown>, imageKey: (next: ImageProvider, raw: Record<string, unknown>) => string,
	searchKey: (id: SearchProviderId, raw: Record<string, unknown>) => string): Saved {
	const imageIds = new Set<string>(), searchIds = new Set<SearchProviderId>();
	const images = list(input.images, 16, "图像提供商").map(value => {
		const raw = row(value);
		const id = requiredString(raw.id, 100, "图像提供商编号");
		if (imageIds.has(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) invalid("图像提供商编号无效或重复");
		imageIds.add(id);
		const name = requiredString(raw.name, 100, "提供商名称");
		const baseUrl = endpoint(raw.baseUrl);
		const models = list(raw.models, 32, "每个提供商的模型").map(model => requiredString(model, 200, "模型 ID"));
		if (!models.length || new Set(models).size !== models.length || models.some(model => /[\r\n]/.test(model))) invalid("请填写不重复的模型 ID");
		const responseFormat = raw.responseFormat;
		if (responseFormat !== undefined && responseFormat !== "b64_json" && responseFormat !== "url") invalid("不支持此图像返回格式");
		const next: ImageProvider = { id, name, baseUrl, models, ...(responseFormat ? { responseFormat } : {}) };
		return { ...next, secret: imageKey(next, raw) };
	});
	const search = list(input.search, Object.keys(SEARCH_PROVIDERS).length, "搜索提供商").map(value => {
		const raw = row(value), id = searchId(raw.id);
		if (searchIds.has(id)) invalid("搜索提供商不能重复");
		searchIds.add(id);
		return { id, secret: searchKey(id, raw) };
	});
	let preferredImage: ImageSelection | null = null;
	if (images.length || input.preferredImage !== null) {
		if (!input.preferredImage) invalid("请选择首选生图模型");
		const preferred = row(input.preferredImage);
		const provider = images.find(candidate => candidate.id === preferred.providerId);
		const model = provider?.models.find(candidate => candidate === preferred.model);
		if (!provider || !model) invalid("首选生图模型必须来自已配置的提供商");
		preferredImage = { providerId: provider.id, model };
	}
	const preferredSearch = input.preferredSearch === null ? null : searchId(input.preferredSearch);
	if (search.length ? preferredSearch === null || !searchIds.has(preferredSearch) : preferredSearch !== null) invalid("请选择已配置的首选搜索提供商");
	return { version: 1, images, search, preferredImage, preferredSearch };
}

/** One store per running Supervisor, using the same OS/server vault as connectors. */
export class ToolProviderStore {
	private readonly file: string;
	private readonly vault?: CredentialVault;
	private saved = empty();
	private revision = randomUUID();
	private error?: string;

	constructor(file: string, vault?: CredentialVault) {
		this.file = file;
		this.vault = vault;
		try {
			const input = row(JSON.parse(readFileSync(file, "utf8")));
			if (input.version !== 1) throw Error("version");
			const stored = (raw: Record<string, unknown>) => requiredString(raw.secret, 48000, "已保存密钥");
			this.saved = normalize(input, (_next, raw) => stored(raw), (_id, raw) => stored(raw));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = "无法读取其它提供商配置，请重新配置后保存。";
		}
	}

	state(): ToolProviderState {
		return {
			revision: this.revision,
			images: this.saved.images.map(({ secret: _secret, ...provider }) => ({ ...provider, models: [...provider.models] })),
			search: this.saved.search.map(provider => provider.id),
			preferredImage: this.saved.preferredImage && { ...this.saved.preferredImage },
			preferredSearch: this.saved.preferredSearch,
			...(this.error ? { error: this.error } : {}),
		};
	}

	save(value: unknown): ToolProviderState {
		const input = row(value);
		if (input.revision !== this.revision) throw new ToolProviderError("配置已被修改或服务已重启，请刷新后再保存。", true);
		const next = normalize(input, (provider, raw) => {
			const old = this.saved.images.find(item => item.id === provider.id && item.baseUrl === provider.baseUrl);
			return this.key(raw.apiKey, old?.secret, `${provider.name}：新增提供商或更换 API 地址时需填写密钥`);
		}, (id, raw) => this.key(raw.apiKey, this.saved.search.find(item => item.id === id)?.secret, `请填写 ${SEARCH_PROVIDERS[id]} 的 API Key`));
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(temporary, JSON.stringify(next, null, "\t") + "\n", { mode: 0o600, flag: "wx" });
			renameSync(temporary, this.file);
		} catch {
			rmSync(temporary, { force: true });
			invalid("无法保存其它提供商配置");
		}
		this.saved = next;
		this.revision = randomUUID();
		this.error = undefined;
		return this.state();
	}

	image() {
		const selection = this.saved.preferredImage;
		const provider = this.saved.images.find(item => item.id === selection?.providerId);
		if (!selection || !provider) invalid("尚未配置首选生图模型，请前往设置 → 其它提供商");
		return { baseUrl: provider.baseUrl, model: selection.model, apiKey: this.decrypt(provider.secret),
			...(provider.responseFormat ? { responseFormat: provider.responseFormat } : {}) };
	}

	search() {
		const provider = this.saved.search.find(item => item.id === this.saved.preferredSearch);
		if (!provider) invalid("尚未配置首选搜索提供商，请前往设置 → 其它提供商");
		return { id: provider.id, apiKey: this.decrypt(provider.secret) };
	}

	private key(value: unknown, previous: string | undefined, message: string) {
		if (value === undefined) { if (previous) return previous; invalid(message); }
		const key = requiredString(value, 4096, "API Key");
		if (!/^[\x21-\x7e]+$/.test(key)) invalid("API Key 格式无效");
		try { if (this.vault) return this.vault.encrypt(key).toString("base64"); }
		catch { /* Never expose vault failures or input values. */ }
		return invalid("凭据加密不可用，无法保存密钥");
	}

	private decrypt(secret: string) {
		try { if (this.vault) return this.vault.decrypt(Buffer.from(secret, "base64")); }
		catch { /* Never expose vault failures or stored values. */ }
		return invalid("无法读取已保存的密钥，请在其它提供商设置中重新填写");
	}
}
