import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../memory-store.ts";

export const MODEL_RESULT_BYTES = 24 * 1024;

/** Immutable, content-addressed evidence. Repeated reads do not create duplicate files. */
export function saveDetails(directory: string, content: string, extension = "json") {
	const sha256 = createHash("sha256").update(content).digest("hex");
	const path = join(directory, `${sha256}.${extension}`);

	mkdirSync(directory, { recursive: true, mode: 0o700 });
	if (existsSync(path)) {
		if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sha256) {
			throw new Error("DETAILS_CHANGED: 完整记录文件已被修改，请重新生成记录");
		}
	} else atomicWrite(path, content);
	return { path, sha256 };
}

export function clipText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const end = text.charCodeAt(maxChars - 1);
	return `${text.slice(0, end >= 0xd800 && end <= 0xdbff ? maxChars - 1 : maxChars)}… [truncated]`;
}

/** A preview is explicitly incomplete and must never be used as authorization evidence. */
export function dataPreview(value: unknown, depth = 0): unknown {
	if (typeof value === "string") return clipText(value, 1000);
	if (value === null || typeof value !== "object") return value;
	if (depth >= 4) return Array.isArray(value) ? { omittedItems: value.length } : "[details omitted]";
	if (Array.isArray(value)) return value.slice(0, 10).map(item => dataPreview(item, depth + 1));
	return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, dataPreview(item, depth + 1)]));
}

export function boundedJson(data: Record<string, unknown>, directory: string, budget = MODEL_RESULT_BYTES): Record<string, unknown> {
	const text = JSON.stringify(data);
	const bytes = Buffer.byteLength(text, "utf8");
	if (bytes <= budget) return data;
	const detailsFile = saveDetails(directory, JSON.stringify(data, null, 2));
	const preview = dataPreview(data);
	return {
		truncated: true, bytes, detailsFile,
		...(Buffer.byteLength(JSON.stringify(preview), "utf8") < budget / 2 ? { preview } : {}),
		note: "Incomplete preview. Read/grep detailsFile.path in bounded sections for the full record; do not infer authorization from omitted text.",
	};
}

export function boundedRelay(text: string, directory: string): string {
	if (Buffer.byteLength(text, "utf8") <= MODEL_RESULT_BYTES) return text;
	const detailsFile = saveDetails(directory, text, "txt");
	return `Large host relay saved in full: ${JSON.stringify(detailsFile)}\nRead/grep this file in bounded sections; use task_read for current questions and gates. This preview is incomplete and never authorizes an action.\n${clipText(text, 2000)}`;
}

export function boundedItems<T>(items: T[], budget: number): { items: T[]; omitted: number } {
	const selected: T[] = [];
	let bytes = 2;
	for (const item of items) {
		const size = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
		if (bytes + size > budget) break;
		selected.push(item);
		bytes += size;
	}
	return { items: selected, omitted: items.length - selected.length };
}
