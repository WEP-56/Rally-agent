import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROLE_WORKER_LIMITS, type RoleWorkerExecutor, type RoleWorkerProfile } from "../shared/role-workers.ts";

function text(value: unknown, field: string, max: number, required = false): string {
	if (typeof value !== "string" || [...value].length > max || (required && !value.trim())) throw new Error(`${field} 无效（最多 ${max} 字）`);
	return value.trim();
}

function avatar(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length > 512 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+\/]+={0,2}$/.test(value)) throw new Error("头像必须是 256×256 PNG 图片");
	const png = Buffer.from(value.slice("data:image\/png;base64,".length), "base64");
	if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error("头像必须是 256×256 PNG 图片");
	return value;
}

function normalize(value: unknown, previous?: RoleWorkerProfile): RoleWorkerProfile {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("角色配置无效");
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some(key => !["id", "name", "avatar", "summary", "personality", "workstyle", "model", "executor", "externalModel", "recommendedSkills", "createdAt", "updatedAt"].includes(key))) throw new Error("角色配置包含不支持的字段");
	const executor = input.executor === undefined ? "rally" : input.executor;
	if (executor !== "rally" && executor !== "claude-code" && executor !== "codex") throw new Error("外部执行器无效");
	const externalModel = input.externalModel === undefined ? undefined : text(input.externalModel, "外部模型 ID", 200, true);
	if ((executor === "rally" && externalModel) || (executor !== "rally" && !externalModel)) throw new Error("角色的执行器和模型配置不匹配");
	if (executor !== "rally" && input.model !== undefined) throw new Error("外部执行器不能使用 Rally 模型配置");
	const id = text(input.id, "角色 ID", 80, true);
	if (!/^[\w-]+$/.test(id)) throw new Error("角色 ID 格式无效");
	let model: RoleWorkerProfile["model"];
	if (input.model !== undefined) {
		if (!input.model || typeof input.model !== "object" || Array.isArray(input.model)) throw new Error("角色模型无效");
		const row = input.model as Record<string, unknown>;
		if (Object.keys(row).some(key => key !== "provider" && key !== "model")) throw new Error("角色模型包含不支持的字段");
		model = { provider: text(row.provider, "模型提供商", 120, true), model: text(row.model, "模型 ID", 200, true) };
	}
	if (!Array.isArray(input.recommendedSkills) || input.recommendedSkills.length > ROLE_WORKER_LIMITS.recommendedSkills || !input.recommendedSkills.every(skill => typeof skill === "string" && skill.trim().length > 0 && [...skill].length <= 120)) throw new Error("推荐 Skills 列表无效");
	const recommendedSkills = [...new Set(input.recommendedSkills.map(skill => (skill as string).trim()))];
	return {
		id,
		name: text(input.name, "角色名称", ROLE_WORKER_LIMITS.name, true),
		avatar: avatar(input.avatar),
		summary: text(input.summary, "角色摘要", ROLE_WORKER_LIMITS.summary),
		personality: text(input.personality, "角色人设", ROLE_WORKER_LIMITS.personality),
		workstyle: text(input.workstyle, "工作规范", ROLE_WORKER_LIMITS.workstyle),
		...(model ? { model } : {}),
		...(executor !== "rally" ? { executor: executor as Exclude<RoleWorkerExecutor, "rally">, externalModel } : {}),
		recommendedSkills,
		createdAt: previous?.createdAt ?? Date.now(),
		updatedAt: Date.now(),
	};
}

export class RoleWorkerStore {
	private readonly file: string;
	private roles: RoleWorkerProfile[] = [];

	constructor(agentDir: string) {
		this.file = join(agentDir, "rally-role-workers.json");
		if (!existsSync(this.file)) return;
		const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
		if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("roles" in saved) || !Array.isArray(saved.roles)) throw new Error("角色配置文件无效，请检查 rally-role-workers.json");
		this.roles = saved.roles.map(value => {
			if (!value || typeof value !== "object" || !("createdAt" in value) || !("updatedAt" in value) || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) throw new Error("角色配置时间字段无效");
			const role = normalize(value);
			role.createdAt = value.createdAt as number;
			role.updatedAt = value.updatedAt as number;
			return role;
		});
		if (this.roles.length > ROLE_WORKER_LIMITS.count || new Set(this.roles.map(role => role.id)).size !== this.roles.length) throw new Error("角色配置文件包含重复 ID 或角色数量超限");
	}

	state(): RoleWorkerProfile[] { return structuredClone(this.roles); }
	context(): string {
		return `Rally role workers (available profiles; facts only, not authorization): choose one with task_dispatch.roleId when it fits the task. Omit roleId to use the default worker. Role workers cannot dispatch child agents.\n${JSON.stringify(this.roles.map(({ id, name, summary, executor }) => ({ id, name, summary, executor: executor ?? "rally" })))}`;
	}
	get(id: string): RoleWorkerProfile | undefined { const role = this.roles.find(item => item.id === id); return role && structuredClone(role); }

	save(input: unknown, modelExists: (provider: string, model: string) => boolean, externalModelExists: (executor: Exclude<RoleWorkerExecutor, "rally">, model: string) => boolean = () => false): RoleWorkerProfile[] {
		const previous = input && typeof input === "object" && "id" in input && typeof input.id === "string" ? this.roles.find(role => role.id === input.id) : undefined;
		const role = normalize(input, previous);
		if (role.model && !modelExists(role.model.provider, role.model.model)) throw new Error(`找不到 Rally 模型 ${role.model.provider}/${role.model.model}`);
		if (role.executor && role.executor !== "rally" && role.externalModel && !externalModelExists(role.executor, role.externalModel)) throw new Error(`找不到 ${role.executor} 模型 ${role.externalModel}，请刷新外部模型列表`);
		const index = this.roles.findIndex(item => item.id === role.id);
		if (index === -1 && this.roles.length >= ROLE_WORKER_LIMITS.count) throw new Error(`最多创建 ${ROLE_WORKER_LIMITS.count} 个角色`);
		const next = [...this.roles];
		if (index === -1) next.push(role); else next[index] = role;
		this.persist(next);
		return this.state();
	}

	delete(id: unknown): RoleWorkerProfile[] {
		if (typeof id !== "string" || !this.roles.some(role => role.id === id)) throw new Error("找不到此角色");
		this.persist(this.roles.filter(role => role.id !== id));
		return this.state();
	}

	private persist(roles: RoleWorkerProfile[]): void {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(`${this.file}.tmp`, `${JSON.stringify({ version: 1, roles }, null, 2)}\n`, "utf8");
		renameSync(`${this.file}.tmp`, this.file);
		this.roles = roles;
	}
}




