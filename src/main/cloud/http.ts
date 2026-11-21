import type { IncomingMessage, ServerResponse } from "node:http";

/** Only explicitly public validation errors may cross the device boundary. */
export class PublicError extends Error {
	readonly status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 1024 * 1024) throw new PublicError("请求不能超过 1 MiB", 413);
		chunks.push(chunk);
	}
	let value: unknown;
	try {
		value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
	} catch {
		throw new PublicError("无效的 JSON 请求");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicError("请求必须是对象");
	return value as Record<string, unknown>;
}

export function reply(res: ServerResponse, status: number, value: unknown) {
	if (res.destroyed || res.writableEnded) return;
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(value ?? null));
}

export function failure(res: ServerResponse, error: unknown) {
	if (res.headersSent) {
		res.destroy();
		return;
	}
	reply(res, error instanceof PublicError ? error.status : 400, {
		error: error instanceof PublicError ? error.message : "操作失败，请检查配置和请求状态后重试",
	});
}
