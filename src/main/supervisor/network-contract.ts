import { Type, type Static } from "typebox";

export const FetchPageSchema = Type.Object({ url: Type.String({ minLength: 1 }), maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false });
export const HttpRequestSchema = Type.Object({
	method: Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE"), Type.Literal("HEAD")]),
	url: Type.String({ minLength: 1 }), headers: Type.Optional(Type.Record(Type.String(), Type.String())), body: Type.Optional(Type.String()),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 120000 })),
}, { additionalProperties: false });
export type FetchPageInput = Static<typeof FetchPageSchema>;
export type HttpRequestInput = Static<typeof HttpRequestSchema>;
export interface FetchPageResult { url: string; finalUrl: string; status: number; title: string; text: string; truncated: boolean; nextOffset?: number }
export interface HttpRequestResult { url: string; finalUrl: string; status: number; headers: Record<string, string>; body: string; truncated: boolean }
export type NetworkRequest = { tool: "fetch_page"; input: FetchPageInput } | { tool: "http_request"; input: HttpRequestInput };
export type NetworkResult = FetchPageResult | HttpRequestResult;
export interface NetworkHop { type: "request"; sequence: number; host: string; method: HttpRequestInput["method"] }
export type NetworkMessage = NetworkHop | { type: "result"; value: NetworkResult } | { type: "error"; message: string };

export function networkUrl(value: string): URL {
	if (typeof value !== "string" || value.length > 16384 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) throw new Error("NETWORK_URL_INVALID: 请提供 HTTP(S) 绝对 URL，不含空白或控制字符");
	let url: URL;
	try { url = new URL(value); } catch { throw new Error("NETWORK_URL_INVALID: URL 无效"); }
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("NETWORK_URL_INVALID: 仅支持无内嵌凭据的 HTTP(S) URL；鉴权请使用显式 header");
	url.hash = ""; return url;
}

export function validateNetworkRequest(request: NetworkRequest): number {
	const { input } = request; networkUrl(input.url);
	if (request.tool === "fetch_page") {
		if (Object.keys(input).some(key => !["url", "maxChars", "offset"].includes(key))) throw new Error("NETWORK_ARGUMENT_INVALID: fetch_page 只接受 url/maxChars/offset");
		const { offset = 0, maxChars = 20000 } = request.input;
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 100000) throw new Error("NETWORK_ARGUMENT_INVALID: offset 为非负整数，maxChars 为 1–100000");
		return 30000;
	}
	if (request.tool !== "http_request" || Object.keys(input).some(key => !["url", "method", "headers", "body", "timeoutMs"].includes(key))) throw new Error("NETWORK_ARGUMENT_INVALID: 不支持的网络动作或字段");
	const { method, body, headers, timeoutMs = 30000 } = request.input;
	if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) throw new Error("NETWORK_ARGUMENT_INVALID: 不支持的 HTTP 方法");
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error("NETWORK_ARGUMENT_INVALID: timeoutMs 为 100–120000 毫秒");
	if (body !== undefined && (typeof body !== "string" || Buffer.byteLength(body) > 1024 * 1024 || method === "GET" || method === "HEAD")) throw new Error("NETWORK_ARGUMENT_INVALID: GET/HEAD 不接受 body，其他方法仅接受最多 1 MiB 的字符串正文");
	if (headers !== undefined) {
		if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw new Error("NETWORK_ARGUMENT_INVALID: headers 必须为字符串字典");
		let size = 0;
		for (const [key, value] of Object.entries(headers)) {
			if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || typeof value !== "string" || /[\r\n\0]/.test(value) || /^(?:host|content-length|connection|transfer-encoding|upgrade|proxy-.*|te|trailer|accept-encoding)$/i.test(key)) throw new Error("NETWORK_ARGUMENT_INVALID: header 名称/值无效，或属于传输层保留字段");
			size += Buffer.byteLength(key) + Buffer.byteLength(value);
		}
		if (size > 32768) throw new Error("NETWORK_ARGUMENT_INVALID: headers 超过 32 KiB");
	}
	return timeoutMs;
}
