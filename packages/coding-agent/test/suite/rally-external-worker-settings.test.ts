import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readClaudeModelConfiguration } from "../../../../src/main/supervisor/claude-model-settings.ts";
import { hideCodexConsole } from "../../../../src/main/external-worker-spawn-policy.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("external worker host settings", () => {
	it("passes through Claude model preferences only", () => {
		const root = mkdtempSync(join(tmpdir(), "rally-claude-settings-")); directories.push(root);
		const config = join(root, "claude-profile"); mkdirSync(config);
		writeFileSync(join(config, "settings.json"), JSON.stringify({
			model: "configured-model", availableModels: ["configured-model", "second-model"],
			modelOverrides: { sonnet: "gateway/sonnet" },
			modelPicker: { options: [{ model: "gateway/sonnet", label: "My Sonnet" }] },
			env: {
				ANTHROPIC_AUTH_TOKEN: "fixture-secret", ANTHROPIC_BASE_URL: "https://api.example.test",
				ANTHROPIC_MODEL: "configured-model", ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
				ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "My Opus", NODE_OPTIONS: "--require unsafe.js", PATH: "unsafe-path",
			},
			hooks: { SessionStart: [{ command: "must-not-run" }] }, mcpServers: { private: { command: "must-not-load" } },
			permissions: { allow: ["Bash(*)"] },
		}));
		expect(readClaudeModelConfiguration(root, { CLAUDE_CONFIG_DIR: config })).toEqual({
			settings: {
				model: "configured-model", availableModels: ["configured-model", "second-model"],
				modelOverrides: { sonnet: "gateway/sonnet" },
				modelPicker: { options: [{ model: "gateway/sonnet", label: "My Sonnet" }] },
			},
			environment: {
				ANTHROPIC_AUTH_TOKEN: "fixture-secret", ANTHROPIC_BASE_URL: "https://api.example.test",
				ANTHROPIC_MODEL: "configured-model", ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
				ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "My Opus",
			},
		});
	});

	it("returns no model preferences when the configured profile has no settings file", () => {
		const root = mkdtempSync(join(tmpdir(), "rally-claude-empty-")); directories.push(root);
		expect(readClaudeModelConfiguration(tmpdir(), { CLAUDE_CONFIG_DIR: root })).toEqual({ settings: {}, environment: {} });
	});

	it("hides only Codex console processes on Windows", () => {
		const original = { cwd: tmpdir() };
		expect(hideCodexConsole("C:\\Rally\\codex.exe", original, "win32")).toEqual({ ...original, windowsHide: true });
		expect(hideCodexConsole("C:\\Rally\\claude.exe", original, "win32")).toBe(original);
		expect(hideCodexConsole("/usr/bin/codex", original, "linux")).toBe(original);
	});
});
