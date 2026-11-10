import { parentPort, workerData } from "node:worker_threads";
import { networkUrl, validateNetworkRequest, type NetworkRequest, type NetworkMessage, type NetworkResult, type HttpRequestInput } from "./network-contract.ts";
import { pageMarkdown } from "./network-page.ts";

const port = parentPort;
if (!port) throw new Error("NETWORK_HOST_REQUIRES_WORKER");
const request = workerData as NetworkRequest;
const send = (message: NetworkMessage) => port.postMessage(message);
let sequence = 0;

async function perform(): Promise<NetworkResult> {
	validateNetworkRequest(request);
	let url = networkUrl(request.input.url);
	const method: HttpRequestInput["method"] = request.tool === "fetch_page" ? "GET" : request.input.method;
	let headers = new Headers(request.tool === "http_request" ? request.input.headers : { Accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1" });
	const body = request.tool === "http_request" ? request.input.body : undefined;
	for (let hop = 0; ; hop++) {
		if (!headers.has("user-agent")) headers.set("user-agent", "Rally/0.1 (page and HTTP tools)");
		// Persist the attempted access before making each request. No URL/header/body crosses this channel.
		await new Promise<void>(resolve => {
			port!.once("message", () => resolve());
			send({ type: "request", sequence: ++sequence, host: url.hostname, method });
		});
		const response = await fetch(url, { method, headers, body, redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer" });
		if ((method === "GET" || method === "HEAD") && [301, 302, 303, 307, 308].includes(response.status) && response.headers.has("location")) {
			await response.body?.cancel();
			if (hop >= 5) throw new Error("NETWORK_REDIRECT_LIMIT: 重定向超过 5 次");
			const next = networkUrl(new URL(response.headers.get("location")!, url).href);
			if (url.protocol === "https:" && next.protocol === "http:") throw new Error("NETWORK_REDIRECT_DOWNGRADE: 不跟随 HTTPS 到 HTTP 的重定向");
			if (next.origin !== url.origin) headers = new Headers(); // Never forward custom API keys/cookies across origins.
			url = next; continue;
		}
		const contentType = response.headers.get("content-type") ?? "";
		const mime = contentType.split(";")[0].trim().toLowerCase();
		const textual = !mime || mime.startsWith("text/") || /(?:json|xml|javascript|x-www-form-urlencoded)/.test(mime);
		if (!textual && method !== "HEAD" && response.status !== 204 && response.status !== 304) {
			await response.body?.cancel(); throw new Error(`NETWORK_CONTENT_TYPE: 仅支持文本响应，收到 ${mime.slice(0, 120)}`);
		}
		const limit = request.tool === "fetch_page" ? 5 * 1024 * 1024 : 1024 * 1024;
		const { bytes, truncated: byteTruncated } = await readBody(response, limit, request.tool === "fetch_page");
		const source = decode(bytes, contentType);
		if (request.tool === "http_request") {
			const body = source.slice(0, 20000);
			return { url: request.input.url, finalUrl: url.href, status: response.status, headers: Object.fromEntries(response.headers), body, truncated: byteTruncated || source.length > body.length };
		}
		const html = /^(?:text\/html|application\/xhtml\+xml)$/.test(mime) || (!mime && /^\s*(?:<!doctype\s+html|<html\b)/i.test(source));
		const page = html ? pageMarkdown(source, url.href) : { title: "", text: source };
		const offset = request.input.offset ?? 0; const maxChars = request.input.maxChars ?? 20000;
		const text = page.text.slice(offset, offset + maxChars); const next = offset + text.length;
		return { url: request.input.url, finalUrl: url.href, status: response.status, title: page.title, text, truncated: next < page.text.length, ...(next < page.text.length ? { nextOffset: next } : {}) };
	}
}

async function readBody(response: Response, limit: number, requireFull: boolean) {
	if (!response.body) return { bytes: Buffer.alloc(0), truncated: false };
	const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read(); if (done) return { bytes: Buffer.concat(chunks, length), truncated: false };
			if (length + value.byteLength > limit) {
				await reader.cancel();
				if (requireFull) throw new Error("PAGE_TOO_LARGE: 网页解压后超过 5 MiB，未对残缺 HTML 进行正文抽取");
				chunks.push(value.subarray(0, limit - length)); return { bytes: Buffer.concat(chunks, limit), truncated: true };
			}
			chunks.push(value); length += value.byteLength;
		}
	} finally { reader.releaseLock(); }
}
function decode(bytes: Buffer, type: string): string {
	const header = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1];
	const meta = /<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1];
	try { return new TextDecoder(header ?? meta ?? "utf-8").decode(bytes); }
	catch { throw new Error("NETWORK_ENCODING_UNSUPPORTED: 不支持响应声明的字符编码"); }
}
try { send({ type: "result", value: await perform() }); }
catch (error) { send({ type: "error", message: error instanceof Error ? error.message : "NETWORK_REQUEST_FAILED" }); }
