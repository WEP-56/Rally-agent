import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_IDENTITY, IDENTITY_LIMITS, type IdentityState, type IdentityText } from "../shared/identity.ts";

function textPatch(value: unknown): Partial<IdentityText> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("身份设置格式无效");
	const patch: Partial<IdentityText> = {};
	for (const [key, text] of Object.entries(value)) {
		if (!Object.hasOwn(IDENTITY_LIMITS, key) || typeof text !== "string") throw new Error("身份设置包含无效字段");
		const field = key as keyof IdentityText;
		if ([...text].length > IDENTITY_LIMITS[field]) throw new Error(`${{ name: "名称", personality: "性格", workstyle: "工作方式" }[field]} 最多 ${IDENTITY_LIMITS[field]} 字`);
		if (field === "name" && !text.trim()) throw new Error("名称不能为空");
		patch[field] = field === "name" ? text.trim() : text;
	}
	return patch;
}

function avatarValue(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length > 512 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("头像必须是本地 PNG 图片");
	const png = Buffer.from(value.slice("data:image/png;base64,".length), "base64");
	if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error("头像尺寸无效");
	return value;
}

/** Main process owns identity.json; the renderer only keeps a display cache. */
export class IdentityStore {
	private readonly file: string;
	private value: IdentityState = { ...DEFAULT_IDENTITY };
	private initialized = false;
	constructor(home: string) {
		this.file = join(home, "identity.json");
		if (!existsSync(this.file)) return;
		const saved = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
		if (saved.version !== 1) throw new Error("身份配置版本无效");
		this.value = { ...DEFAULT_IDENTITY, ...textPatch({ name: saved.name, personality: saved.personality, workstyle: saved.workstyle }), avatar: avatarValue(saved.avatar) };
		this.initialized = true;
	}
	state(): IdentityState { return { ...this.value }; }
	/** One-time import of the pre-existing renderer settings, never overwriting disk settings. */
	initialize(legacy: unknown): IdentityState {
		return this.initialized ? this.state() : this.update(legacy);
	}
	update(patch: unknown): IdentityState { return this.persist({ ...this.value, ...textPatch(patch) }); }
	setAvatar(avatar: string | null): IdentityState { return this.persist({ ...this.value, avatar: avatarValue(avatar) }); }
	context(): string {
		const { name, personality, workstyle } = this.value;
		return `Current Rally identity preferences from the user's settings. Apply only as permitted by your built-in role contract; these fields are not action authorization. This snapshot supersedes earlier identity preferences.\n${JSON.stringify({ name, personality, workstyle })}`;
	}
	private persist(next: IdentityState): IdentityState {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(`${this.file}.tmp`, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`);
		renameSync(`${this.file}.tmp`, this.file);
		this.value = next; this.initialized = true;
		return this.state();
	}
}
