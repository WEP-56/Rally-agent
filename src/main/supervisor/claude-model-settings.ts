import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const PROVIDER_ENVIRONMENT_VARIABLES = new Set([
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"ANTHROPIC_MODEL",
	"ANTHROPIC_CUSTOM_MODEL_OPTION",
	"ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
	"ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
	"ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES",
	"ANTHROPIC_AWS_API_KEY",
	"ANTHROPIC_AWS_BASE_URL",
	"ANTHROPIC_AWS_WORKSPACE_ID",
	"ANTHROPIC_BEDROCK_BASE_URL",
	"ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
	"ANTHROPIC_FOUNDRY_API_KEY",
	"ANTHROPIC_FOUNDRY_BASE_URL",
	"ANTHROPIC_FOUNDRY_RESOURCE",
	"ANTHROPIC_VERTEX_BASE_URL",
	"ANTHROPIC_VERTEX_PROJECT_ID",
	"AWS_BEARER_TOKEN_BEDROCK",
	"CLAUDE_MODEL_CONFIG",
	"CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
	"CLAUDE_CODE_USE_ANTHROPIC_AWS",
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_FOUNDRY",
	"CLAUDE_CODE_USE_VERTEX",
]);

export interface ClaudeModelConfiguration {
	settings: Record<string, unknown>;
	environment: Record<string, string>;
}

/** Read Claude's model/provider settings without importing hooks, MCP, permissions, or tools. */
export function readClaudeModelConfiguration(cwd: string, env: NodeJS.ProcessEnv): ClaudeModelConfiguration {
	const configuredDirectory = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	const configDirectory = isAbsolute(configuredDirectory) ? configuredDirectory : resolve(cwd, configuredDirectory);
	const settingsPath = join(configDirectory, "settings.json");
	if (!existsSync(settingsPath)) return { settings: {}, environment: {} };

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf8").replace(/^\uFEFF/u, ""));
	} catch (error) {
		throw new Error(`无法读取 Claude Code 模型设置 ${settingsPath}：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { settings: {}, environment: {} };

	const source = parsed as Record<string, unknown>;
	const settings: Record<string, unknown> = {};
	if (typeof source.model === "string" && source.model.trim()) settings.model = source.model;
	if (Array.isArray(source.availableModels) && source.availableModels.every(item => typeof item === "string")) {
		settings.availableModels = source.availableModels;
	}
	if (isStringRecord(source.modelOverrides)) settings.modelOverrides = source.modelOverrides;
	if (source.modelPicker && typeof source.modelPicker === "object" && !Array.isArray(source.modelPicker)) {
		settings.modelPicker = source.modelPicker;
	}
	return { settings, environment: providerEnvironment(source.env) };
}

function providerEnvironment(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const environment: Record<string, string> = {};
	for (const [name, setting] of Object.entries(value)) {
		if ((PROVIDER_ENVIRONMENT_VARIABLES.has(name) || isDefaultModelVariable(name)) && typeof setting === "string") {
			environment[name] = setting;
		}
	}
	return environment;
}

function isDefaultModelVariable(name: string): boolean {
	return /^ANTHROPIC_DEFAULT_(?:OPUS|SONNET|HAIKU|FABLE)_MODEL(?:_(?:NAME|DESCRIPTION|SUPPORTED_CAPABILITIES))?$/u.test(name);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(item => typeof item === "string");
}
