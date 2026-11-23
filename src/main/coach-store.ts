import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CoachSettings, DEFAULT_COACH } from "../shared/coach.ts";
import { THINKING_LEVELS } from "../shared/models.ts";

function settings(value: unknown): CoachSettings {
	if (!value || typeof value !== "object") throw new Error("教练设置格式无效");
	const { enabled, model, quietStart, quietEnd, ideasPerDay } = value as Record<string, unknown>;
	if (typeof enabled !== "boolean") throw new Error("教练开关无效");
	for (const time of [quietStart, quietEnd]) if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("静默时间须为 HH:mm");
	if (quietStart === quietEnd) throw new Error("静默时间的开始和结束不能相同");
	if (ideasPerDay !== 0 && ideasPerDay !== 1 && ideasPerDay !== 2) throw new Error("点子频率无效");
	if (model !== null) {
		const selected = model as Record<string, unknown> | undefined;
		if (!selected || typeof selected.provider !== "string" || !selected.provider || typeof selected.model !== "string" || !selected.model ||
			!(THINKING_LEVELS as readonly unknown[]).includes(selected.thinkingLevel)) throw new Error("教练模型无效");
	}
	const selected = model as CoachSettings["model"];
	return { enabled, model: selected && { provider: selected.provider, model: selected.model, thinkingLevel: selected.thinkingLevel }, quietStart: quietStart as string, quietEnd: quietEnd as string, ideasPerDay };
}

/** Main process owns coach.json. */
export class CoachStore {
	private readonly file: string;
	private value: CoachSettings = { ...DEFAULT_COACH };
	constructor(home: string) {
		this.file = join(home, "coach.json");
		if (existsSync(this.file)) this.value = settings(JSON.parse(readFileSync(this.file, "utf8")));
	}
	state(): CoachSettings { return structuredClone(this.value); }
	update(patch: unknown): CoachSettings {
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("教练设置格式无效");
		const next = settings({ ...this.value, ...patch });
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(`${this.file}.tmp`, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`);
		renameSync(`${this.file}.tmp`, this.file);
		this.value = next;
		return this.state();
	}
}
