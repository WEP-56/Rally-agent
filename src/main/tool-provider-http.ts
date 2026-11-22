import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { BlockList } from "node:net";
import { checkServerIdentity } from "node:tls";
import { SEARCH_PROVIDERS, type SearchProviderId } from "../shared/tool-providers.ts";

const MIB = 1024 * 1024;
export const MAX_GENERATED_IMAGES = 4;
const MAX_IMAGE_BYTES = 16 * MIB;
const MAX_IMAGE_TOTAL = 32 * MIB;
const SEARCH_RESPONSE_LIMIT = MIB;
const IMAGE_TIMEOUT = 180_000;
const SEARCH_TIMEOUT = 25_000;

type Fetch = typeof fetch;
type Observe = (host: string, method: "GET" | "POST") => void;
export interface SearchResult { title: string; url: string; snippet: string; publishedAt?: string }
export interface GeneratedImage { bytes: Buffer; extension: "png" | "jpg" | "webp" }
export interface ImageRequest {
	prompt: string;
	model?: string;
	n?: number;
	size?: string;
	quality?: string;
	style?: string;
	background?: string;
	response_format?: string;
	output_format?: string;
	output_compression?: number;
}

class ResponseError extends Error {}
export class ImageParametersRejected extends ResponseError {}
function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function statusError(status: number) {
	const hint = status === 401 || status === 403 ? "请检查 API Key 和使用权限" : status === 429 ? "请检查调用额度或限流" : status >= 300 && status < 400 ? "不跟随提供商重定向，请检查 API 地址" : "请核对提供商配置与请求参数";
	return new ResponseError(`提供商请求失败（HTTP ${status}），${hint}。`);
}
function operationError(error: unknown, label: string, deadline: AbortSignal, caller?: AbortSignal): never {
	caller?.throwIfAborted();
	if (deadline.aborted) throw Error(`${label}超时`);
	if (error instanceof ResponseError) throw error;
	throw Error(`${label}失败，请检查服务地址或网络连接`);
}
async function readJson(response: Response, max: number): Promise<unknown> {
	if (!response.ok) {
		await response.body?.cancel();
		throw statusError(response.status);
	}
	return readJsonBody(response, max);
}
async function readBody(response: Response, max: number): Promise<Buffer> {
	const reader = response.body?.getReader();
	if (!reader) throw new ResponseError("提供商返回空响应");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > max) {
				await reader.cancel();
				throw new ResponseError("提供商响应超过体积限制");
			}
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	return Buffer.concat(chunks, size);
}
async function readJsonBody(response: Response, max: number): Promise<unknown> {
	const bytes = await readBody(response, max);
	try { return JSON.parse(bytes.toString("utf8")); }
	catch { throw new ResponseError("提供商未返回有效 JSON"); }
}

function imageFromBytes(bytes: Buffer): GeneratedImage {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { bytes, extension: "png" };
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { bytes, extension: "jpg" };
	if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { bytes, extension: "webp" };
	throw new ResponseError("提供商没有返回受支持的 PNG、JPEG 或 WebP 图片");
}
function base64Image(data: string, limit: number) {
	if (data.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1) throw new ResponseError("图像数据无效或超过体积限制");
	const bytes = Buffer.from(data, "base64");
	if (bytes.length > limit) throw new ResponseError("图像超过体积限制");
	return bytes;
}

const nonPublic = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
	["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
	["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) nonPublic.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) nonPublic.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

/** Legacy-compatible image URLs are untrusted data. Pin the checked DNS address for the TLS connection. */
async function downloadImage(value: string, limit: number, signal: AbortSignal, observe?: Observe) {
	let url: URL;
	try { url = new URL(value); }
	catch { throw new ResponseError("提供商返回了无效图像地址"); }
	if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || value.length > 8192) throw new ResponseError("图像下载仅接受公开 HTTPS 地址");
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = await abortable(lookup(hostname, { all: true }), signal);
	const publicAddress = ({ address, family }: (typeof addresses)[number]) => family === 4
		? !nonPublic.check(address, "ipv4")
		: globalV6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
	const target = addresses[0];
	if (!target || !addresses.every(publicAddress)) throw new ResponseError("图像地址指向非公开网络，若提供商支持，请将图片返回方式设为 Base64 图片数据");
	observe?.(hostname, "GET");
	return new Promise<Buffer>((resolve, reject) => {
		const request = get({
			hostname: target.address, family: target.family, path: url.pathname + url.search, agent: false, signal,
			...(hostname === target.address ? {} : { servername: hostname }),
			checkServerIdentity: (_host, certificate) => checkServerIdentity(hostname, certificate),
			headers: { Host: url.host, Accept: "image/png,image/jpeg,image/webp,application/octet-stream" },
		}, response => {
			response.once("error", reject);
			if (response.statusCode !== 200) {
				response.destroy(); reject(new ResponseError(`图像下载失败（HTTP ${response.statusCode ?? 0}）`)); return;
			}
			let size = 0;
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > limit) { response.destroy(new ResponseError("图像超过体积限制")); return; }
				chunks.push(chunk);
			});
			response.on("end", () => resolve(Buffer.concat(chunks, size)));
		});
		request.once("error", reject);
	});
}

async function readImageItem(value: unknown, limit: number, signal: AbortSignal, observe?: Observe): Promise<GeneratedImage> {
	const image = object(value);
	if (typeof image.b64_json === "string" && image.b64_json.trim()) {
		return imageFromBytes(base64Image(image.b64_json.trim(), limit));
	}
	if (typeof image.url !== "string" || !image.url.trim()) throw new ResponseError("提供商响应缺少图片数据或地址");
	const url = image.url.trim();
	if (/^data:/i.test(url)) {
		const prefix = /^data:image\/(?:png|jpeg|webp);base64,/i.exec(url)?.[0];
		if (!prefix) throw new ResponseError("提供商返回了不支持的内嵌图片格式");
		return imageFromBytes(base64Image(url.slice(prefix.length), limit));
	}
	return imageFromBytes(await downloadImage(url, limit, signal, observe));
}

const parameterFields = new Set<string>(["prompt", "model", "n", "size", "quality", "style", "background", "response_format", "output_format", "output_compression"]);
const parameterCodes = new Set(["invalid_parameter", "unknown_parameter", "unsupported_parameter", "invalid_value", "unsupported_value", "missing_required_parameter", "string_above_max_length"]);

async function rejectImageResponse(response: Response, signal: AbortSignal, apiKey: string): Promise<never> {
	if (response.status >= 500) {
		const ids = ["x-request-id", "cf-ray"].flatMap(name => {
			const value = response.headers.get(name);
			return value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) && !value.includes(apiKey) ? [`${name}: ${value}`] : [];
		});
		await response.body?.cancel();
		const trace = ids.length ? `（${ids.join("，")}）` : "";
		throw new ResponseError(`图像提供商或网关返回 HTTP ${response.status}${trace}。请求结果未知，请检查提供商网关和上游日志。`);
	}
	if (response.status !== 400 && response.status !== 422) {
		await response.body?.cancel();
		throw statusError(response.status);
	}
	let error: Record<string, unknown> = {};
	try { error = object(object(await readJsonBody(response, 16 * 1024)).error); }
	catch { signal.throwIfAborted(); }
	const field = typeof error.param === "string" && parameterFields.has(error.param) ? error.param : undefined;
	const code = typeof error.code === "string" ? error.code : "";
	// A bare 400/422 may be a policy or permission error; only clear parameter errors allow a correction.
	const explicit = parameterCodes.has(code) || (!code && field && field !== "prompt" && error.type === "invalid_request_error");
	const detail = field ? `（${field}）` : "";
	if (explicit) throw new ImageParametersRejected(`提供商拒绝了请求参数${detail}（HTTP ${response.status}）。请按该模型支持的参数调整一次，或向用户索要 API 文档。`);
	throw new ResponseError(`提供商拒绝了图像请求（HTTP ${response.status}）。无法确认是参数不兼容，请核对该提供商的 API 文档。`);
}

export async function generateImages(baseUrl: string, apiKey: string, input: ImageRequest, signal?: AbortSignal, observe?: Observe, send: Fetch = fetch): Promise<GeneratedImage[]> {
	const deadline = AbortSignal.timeout(IMAGE_TIMEOUT);
	const active = signal ? AbortSignal.any([deadline, signal]) : deadline;
	let response: Response;
	try {
		active.throwIfAborted();
		const url = new URL(`${baseUrl}/images/generations`);
		observe?.(url.hostname, "POST");
		response = await send(url, {
			method: "POST", signal: active, redirect: "manual", credentials: "omit",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(input),
		});
		if (!response.ok) await rejectImageResponse(response, active, apiKey);
	} catch (error) { return operationError(error, "图像生成", deadline, signal); }
	try {
		const count = input.n ?? 1;
		const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
		if (mediaType && ["image/png", "image/jpeg", "image/webp", "application/octet-stream"].includes(mediaType)) {
			if (count !== 1) {
				await response.body?.cancel();
				throw new ResponseError("提供商只返回了一张图片，与请求数量不符");
			}
			const bytes = await readBody(response, MAX_IMAGE_BYTES);
			active.throwIfAborted();
			return [imageFromBytes(bytes)];
		}
		const { data } = object(await readJsonBody(response, Math.ceil(MAX_IMAGE_TOTAL / 3) * 4 + MIB));
		if (!Array.isArray(data) || data.length !== count) throw new ResponseError("提供商返回的图像数量与请求不符");
		let remaining = MAX_IMAGE_TOTAL;
		const images: GeneratedImage[] = [];
		for (const value of data) {
			const image = await readImageItem(value, Math.min(remaining, MAX_IMAGE_BYTES), active, observe);
			images.push(image);
			remaining -= image.bytes.length;
		}
		active.throwIfAborted();
		return images;
	} catch (error) {
		signal?.throwIfAborted();
		const detail = deadline.aborted ? "读取结果超时" : error instanceof ResponseError ? error.message : "无法读取图片，请检查网络或提供商配置";
		throw new ResponseError(`生图接口已返回 HTTP ${response.status}，但未能获取图片：${detail}。请勿自动重新生成。`);
	}
}

export async function searchWeb(provider: SearchProviderId, apiKey: string, query: string, limit: number, signal?: AbortSignal, observe?: Observe, send: Fetch = fetch): Promise<SearchResult[]> {
	const deadline = AbortSignal.timeout(SEARCH_TIMEOUT);
	const active = signal ? AbortSignal.any([deadline, signal]) : deadline;
	try {
		active.throwIfAborted();
		let url: URL, method: "GET" | "POST" = "POST", body: string | undefined;
		const headers: Record<string, string> = { Accept: "application/json" };
		if (provider === "tavily") {
			url = new URL("https://api.tavily.com/search"); headers.Authorization = `Bearer ${apiKey}`;
			body = JSON.stringify({ query, max_results: limit, search_depth: "basic", include_answer: false, include_raw_content: false });
		} else if (provider === "exa") {
			url = new URL("https://api.exa.ai/search"); headers["x-api-key"] = apiKey;
			body = JSON.stringify({ query, numResults: limit, type: "auto", contents: { highlights: true } });
		} else {
			url = new URL("https://api.search.brave.com/res/v1/web/search"); headers["X-Subscription-Token"] = apiKey;
			url.search = new URLSearchParams({ q: query, count: String(limit), result_filter: "web", text_decorations: "false" }).toString();
			method = "GET";
		}
		if (body) headers["Content-Type"] = "application/json";
		observe?.(url.hostname, method);
		const response = await send(url, { method, headers, body, signal: active, redirect: "manual", credentials: "omit" });
		const value = object(await readJson(response, SEARCH_RESPONSE_LIMIT));
		const results = provider === "brave" ? object(value.web).results ?? (value.web === undefined && value.type === "search" ? [] : undefined) : value.results;
		if (!Array.isArray(results)) throw new ResponseError(`${SEARCH_PROVIDERS[provider]} 未返回有效的搜索结果`);
		active.throwIfAborted();
		return normalizeResults(provider, results, apiKey, limit);
	} catch (error) { return operationError(error, "网络搜索", deadline, signal); }
}

function normalizeResults(provider: SearchProviderId, results: unknown[], key: string, limit: number): SearchResult[] {
	const clean = (value: unknown, max: number) => typeof value === "string" ? value.replaceAll(key, "[已隐藏]").trim().slice(0, max) : "";
	const seen = new Set<string>();
	const normalized: SearchResult[] = [];
	for (const value of results) {
		if (normalized.length >= limit) break;
		const result = object(value);
		if (typeof result.url !== "string" || result.url.length > 2048 || result.url.includes(key)) continue;
		let url: URL;
		try { url = new URL(result.url); }
		catch { continue; }
		if (!/^https?:$/.test(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
		seen.add(url.href);
		const description = provider === "tavily" ? result.content : provider === "brave" ? result.description
			: Array.isArray(result.highlights) ? result.highlights.slice(0, 3).map(item => clean(item, 1000)).filter(Boolean).join("\n") : result.text;
		const publishedAt = clean(result.publishedDate ?? result.published_date ?? result.page_age, 60);
		normalized.push({ title: clean(result.title, 300) || url.hostname, url: url.href, snippet: clean(description, 1500), ...(publishedAt ? { publishedAt } : {}) });
	}
	return normalized;
}
