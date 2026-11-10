import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadMcpConfig, validateMcpServerConfig, type LoadedMcpConfig } from "@rally/coding-agent";
import type { McpConfigurationState, McpExposure, McpRiskTier } from "../shared/mcp.ts";
import { projectSettings } from "./project-trust.ts";

/** Global configuration editor. Reading or saving never starts a transport. */
export class McpStore {
	private readonly agentDir: string;
	private readonly file: string;
	constructor(agentDir: string) { this.agentDir = agentDir; this.file = join(agentDir, "mcp.json"); }
	state(): McpConfigurationState {
		const json = existsSync(this.file) ? readFileSync(this.file, "utf8") : '{\n  "mcpServers": {}\n}';
		const loaded = loadMcpConfig({ agentDir: this.agentDir, cwd: this.agentDir, projectTrusted: false });
		const errors = [...loaded.errors];
		let tiers: Record<string, McpRiskTier> = {};
		try { tiers = this.tiers(); } catch (error) { errors.push(String(error)); }
		let names: string[] = [];
		try { names = this.discoveredTools(); } catch (error) { errors.push(String(error)); }
		return { json, errors, tools: [...new Set([...names, ...Object.keys(tiers)])].sort().map((name) => ({ name, tier: tiers[name] ?? "reversible" })), servers: loaded.servers.map(({ name, config }) => ({ name,
			enabled: config.enabled !== false, transport: "url" in config ? "http" : "stdio",
			address: "url" in config ? config.url : [config.command, ...(config.args ?? [])].join(" "),
			exposure: config.exposure ?? "direct", toolExposure: { ...config.toolExposure },
		})) };
	}
	forProject(cwd: string): LoadedMcpConfig {
		return loadMcpConfig({ agentDir: this.agentDir, cwd, projectTrusted: projectSettings(cwd, this.agentDir, true).isProjectTrusted() });
	}
	/** Edit one server while preserving the other entries and top-level settings. */
	saveServer(name: string, json: string, originalName?: string): McpConfigurationState {
		if (typeof name !== "string" || !name.trim() || typeof json !== "string" || (originalName !== undefined && typeof originalName !== "string")) throw new Error("请填写服务器名称与配置");
		const state = this.state();
		const parsed: unknown = JSON.parse(state.json.replace(/^\uFEFF/, ""));
		if (!record(parsed) || !record(parsed.mcpServers)) throw new Error("请先在 JSON 中修复配置");
		if (originalName !== undefined && !Object.hasOwn(parsed.mcpServers, originalName)) throw new Error("服务器已不存在，请刷新");
		if (name !== originalName && Object.hasOwn(parsed.mcpServers, name)) throw new Error("该名称已存在，请使用列表中的编辑按钮");
		const entry: unknown = JSON.parse(json);
		const validated = validateMcpServerConfig(name, entry);
		if (typeof validated === "string") throw new Error(validated);
		if (originalName !== undefined && originalName !== name) delete parsed.mcpServers[originalName];
		Object.defineProperty(parsed.mcpServers, name, { value: entry, enumerable: true, configurable: true, writable: true });
		return this.save(JSON.stringify(parsed));
	}
	/** Global defaults and server-native tool names/patterns; existing worker sessions keep their config. */
	setExposure(name: string, exposure: McpExposure | null, tool?: string): McpConfigurationState {
		if (typeof name !== "string" || (exposure !== null && !["direct", "deferred", "codemode", "hidden"].includes(exposure)) ||
			(tool !== undefined && (typeof tool !== "string" || !tool.trim()))) throw new Error("无效的 MCP 披露设置");
		const state = this.state();
		if (state.errors.length) throw new Error(state.errors.join("\n"));
		const parsed: unknown = JSON.parse(state.json.replace(/^\uFEFF/, ""));
		if (!record(parsed) || !record(parsed.mcpServers) || !Object.hasOwn(parsed.mcpServers, name)) throw new Error("服务器不存在，请刷新");
		const entry = parsed.mcpServers[name];
		if (!record(entry)) throw new Error("服务器配置无效");
		if (tool === undefined) {
			if (exposure === null) delete entry.exposure;
			else entry.exposure = exposure;
		} else {
			const rules = record(entry.toolExposure) ? { ...entry.toolExposure } : {};
			if (exposure === null) delete rules[tool];
			else Object.defineProperty(rules, tool, { value: exposure, enumerable: true, configurable: true, writable: true });
			if (Object.keys(rules).length) entry.toolExposure = rules;
			else delete entry.toolExposure;
		}
		return this.save(JSON.stringify(parsed));
	}
	tier(name: string): McpRiskTier { return this.tiers()[name] ?? "reversible"; }
	setTier(name: string, tier: McpRiskTier): McpConfigurationState {
		if (!toolName(name) || !["reversible", "external", "irreversible"].includes(tier)) throw new Error("无效的 MCP 工具或风险档");
		const settings = this.settings();
		const tiers = this.tiers();
		tiers[name] = tier;
		const file = join(this.agentDir, "settings.json");
		writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...settings, mcpTiers: tiers }, null, 2)}\n`, "utf8");
		renameSync(`${file}.tmp`, file);
		return this.state();
	}
	/** Cache names actually declared by MCP, never fabricate connected state or tool counts. */
	recordTool(name: string): void {
		if (!toolName(name)) return;
		const names = this.discoveredTools();
		if (names.includes(name)) return;
		const file = join(this.agentDir, "rally-mcp-tools.json");
		writeFileSync(`${file}.tmp`, `${JSON.stringify([...names, name].sort())}\n`, "utf8");
		renameSync(`${file}.tmp`, file);
	}
	private discoveredTools(): string[] {
		const file = join(this.agentDir, "rally-mcp-tools.json");
		if (!existsSync(file)) return [];
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!Array.isArray(parsed) || !parsed.every(toolName)) throw new Error("MCP 工具记录损坏");
		return parsed;
	}
	private settings(): Record<string, unknown> {
		const file = join(this.agentDir, "settings.json");
		const parsed: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : {};
		if (!record(parsed)) throw new Error("settings.json 必须是对象");
		return parsed;
	}
	private tiers(): Record<string, McpRiskTier> {
		const tiers = this.settings().mcpTiers;
		if (tiers === undefined) return {};
		if (!record(tiers) || !Object.entries(tiers).every(([key, value]) => toolName(key) && ["reversible", "external", "irreversible"].includes(String(value)))) throw new Error("MCP_RISK_CONFIG_INVALID: mcpTiers 必须按工具名配置 reversible、external 或 irreversible");
		return tiers as Record<string, McpRiskTier>;
	}
	save(json: string): McpConfigurationState {
		if (typeof json !== "string") throw new Error("MCP 配置必须是 JSON 文本");
		const parsed: unknown = JSON.parse(json.replace(/^\uFEFF/, ""));
		if (!record(parsed) || !record(parsed.mcpServers)) throw new Error("配置必须包含 mcpServers 对象");
		if (parsed.autoEnableCodemode !== undefined && typeof parsed.autoEnableCodemode !== "boolean") throw new Error("autoEnableCodemode 必须是布尔值");
		const namespaces = new Set<string>();
		for (const [name, value] of Object.entries(parsed.mcpServers)) {
			const validated = validateMcpServerConfig(name, value);
			if (typeof validated === "string") throw new Error(validated);
			const namespace = name.replace(/-/g, "_");
			if (namespaces.has(namespace)) throw new Error(`服务器名冲突：${name}`);
			namespaces.add(namespace);
		}
		writeFileSync(`${this.file}.tmp`, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
		renameSync(`${this.file}.tmp`, this.file);
		return this.state();
	}
	update(name: string, enabled: boolean | null): McpConfigurationState {
		if (typeof name !== "string" || (enabled !== null && typeof enabled !== "boolean")) throw new Error("无效的 MCP 设置");
		const state = this.state();
		if (state.errors.length) throw new Error(state.errors.join("\n"));
		const parsed: unknown = JSON.parse(state.json.replace(/^\uFEFF/, ""));
		if (!record(parsed) || !record(parsed.mcpServers) || !Object.hasOwn(parsed.mcpServers, name)) throw new Error("服务器不存在，请刷新");
		if (enabled === null) delete parsed.mcpServers[name];
		else {
			const entry = parsed.mcpServers[name];
			if (!record(entry)) throw new Error("服务器配置无效");
			entry.enabled = enabled;
		}
		return this.save(JSON.stringify(parsed));
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toolName(value: unknown): value is string {
	return typeof value === "string" && /^mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_]+$/.test(value);
}
