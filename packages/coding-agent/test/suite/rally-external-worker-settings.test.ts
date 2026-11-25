import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readClaudeModelConfiguration } from "../../../../src/main/supervisor/claude-model-settings.ts";
import { hideCodexConsole } from "../../../../src/main/external-worker-spawn-policy.ts";
import { resolveExternalWorkerRuntime } from "../../../../src/main/supervisor/external-worker-runtime.ts";
import { ExternalWorkerSession } from "../../../../src/main/supervisor/external-worker-session.ts";

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function runtimeFixture() {
	const root = mkdtempSync(join(tmpdir(), "rally-external-runtime-"));
	directories.push(root);
	const file = (path: string, content = "fixture") => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		return path;
	};
	return { root, file, options: { agentDir: root, env: {}, home: root } };
}

describe("external worker runtime discovery", () => {
	it("does not install anything or fall back to application dependencies when an adapter is missing", () => {
		const { root, options } = runtimeFixture();
		expect(() => resolveExternalWorkerRuntime("codex", options)).toThrow(/自我管理 Skill/);
		expect(readdirSync(root)).toEqual([]);
	});

	it("uses a managed adapter and prefers the user's agent bin over PATH", () => {
		const { root, file, options } = runtimeFixture();
		const entry = file(join(root, "external-agents/codex/node_modules/@agentclientprotocol/codex-acp/dist/index.js"));
		const name = process.platform === "win32" ? "codex.exe" : "codex";
		const executable = file(join(root, "bin", name));
		file(join(root, "path", name));
		expect(resolveExternalWorkerRuntime("codex", { ...options, env: { Path: join(root, "path") } })).toEqual({ entry, executable });
		rmSync(executable);
		expect(resolveExternalWorkerRuntime("codex", { ...options, env: { Path: join(root, "path") } }).executable).toBe(join(root, "path", name));
	});

	it("reuses configured adapters and executables, and rejects broken explicit paths instead of silently switching", () => {
		const { root, file, options } = runtimeFixture();
		const entry = file(join(root, "existing-adapter/index.js"));
		const executable = file(join(root, "existing-cli/claude.exe"));
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: entry, executablePath: executable } }));
		expect(resolveExternalWorkerRuntime("claude-code", { ...options, env: { CLAUDE_CODE_EXECUTABLE: "ignored" } })).toEqual({ entry, executable });
		rmSync(executable);
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/executablePath/);
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: "relative/index.js" } }));
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/绝对路径/);
		file(join(root, "external-agents.json"), "not json");
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/JSON/);
	});

	it("honors the host CLI environment override and finds native user installs without it", () => {
		const { root, file, options } = runtimeFixture();
		const entry = file(join(root, "external-agents/claude-code/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"));
		const executable = file(join(root, ".local/bin", process.platform === "win32" ? "claude.exe" : "claude"));
		expect(resolveExternalWorkerRuntime("claude-code", options)).toEqual({ entry, executable });
		const override = file(join(root, "explicit-claude"));
		expect(resolveExternalWorkerRuntime("claude-code", { ...options, env: { CLAUDE_CODE_EXECUTABLE: override } }).executable).toBe(override);
		rmSync(executable);
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/未找到 claude/);
	});

	it("resolves a Codex native runtime installed on demand without a global Node or CLI", () => {
		const { root, file, options } = runtimeFixture();
		const modules = join(root, "external-agents/codex/node_modules");
		const entry = file(join(modules, "@agentclientprotocol/codex-acp/dist/index.js"));
		file(join(modules, "@openai/codex/package.json"), '{"name":"@openai/codex","bin":{"codex":"bin/codex.js"}}');
		file(join(modules, "@openai/codex/bin/codex.js"));
		const native = join(modules, `@openai/codex-${process.platform}-${process.arch}`);
		file(join(native, "package.json"), '{"name":"@openai/codex"}');
		const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`;
		const executable = file(join(native, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex"));
		expect(resolveExternalWorkerRuntime("codex", options)).toEqual({ entry, executable });
		if (process.platform === "win32") {
			const shim = file(join(modules, ".bin/codex.cmd"));
			expect(resolveExternalWorkerRuntime("codex", { ...options, env: { CODEX_PATH: shim } })).toEqual({ entry, executable });
		}
	});

	it.skipIf(process.platform !== "win32")("resolves the npm Claude shim to JavaScript without launching cmd.exe", () => {
		const { root, file, options } = runtimeFixture();
		const entry = file(join(root, "adapter/index.js"));
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: entry } }));
		file(join(root, "npm/claude.cmd"));
		const manifest = join(root, "npm/node_modules/@anthropic-ai/claude-code/package.json");
		file(manifest, '{"bin":{"claude":"cli.js"}}');
		const executable = file(join(root, "npm/node_modules/@anthropic-ai/claude-code/cli.js"));
		expect(resolveExternalWorkerRuntime("claude-code", { ...options, env: { PATH: join(root, "npm") } })).toEqual({ entry, executable });
		file(manifest, '{"bin":{"claude":"bin/claude.exe"}}');
		const native = file(join(root, "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"));
		expect(resolveExternalWorkerRuntime("claude-code", { ...options, env: { PATH: join(root, "npm") } }).executable).toBe(native);
	});

	it("finds a Claude SDK native runtime installed on demand for the current platform and libc", () => {
		const { root, file, options } = runtimeFixture();
		const modules = join(root, "external-agents/claude-code/node_modules");
		const entry = file(join(modules, "@agentclientprotocol/claude-agent-acp/dist/index.js"));
		file(join(modules, "@anthropic-ai/claude-agent-sdk/package.json"), '{"main":"sdk.mjs"}');
		file(join(modules, "@anthropic-ai/claude-agent-sdk/sdk.mjs"));
		const binary = process.platform === "win32" ? "claude.exe" : "claude";
		const native = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
		const executable = file(join(modules, native, binary));
		const muslExecutable = file(join(modules, `${native}-musl`, binary));
		const report = process.platform === "linux" ? process.report.getReport() as { header: { glibcVersionRuntime?: string } } : undefined;
		const expected = process.platform === "linux" && !report?.header.glibcVersionRuntime ? muslExecutable : executable;
		expect(resolveExternalWorkerRuntime("claude-code", options)).toEqual({ entry, executable: expected });
	});

	it("starts and closes a user-owned ACP adapter with the selected CLI, without a model request", async () => {
		const { root, file } = runtimeFixture();
		const executable = file(join(root, "cli/claude.exe"));
		const entry = file(join(root, "adapter/index.mjs"), `
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, agentCapabilities: {} };
  else if (request.method === 'session/new') result = { sessionId: 'offline', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fixture', options: [{ value: 'fixture', name: process.env.CLAUDE_CODE_EXECUTABLE }] }] };
  else if (request.method === 'session/close') result = {};
  else throw new Error('Unexpected request: ' + request.method);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`);
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: entry, executablePath: executable } }));
		vi.stubEnv("RALLY_CODING_AGENT_DIR", root);
		vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "empty-profile"));
		const session = await ExternalWorkerSession.start({ executor: "claude-code", cwd: root, mode: "readonly" });
		try { expect(session.models).toEqual([{ id: "fixture", name: executable }]); }
		finally { await session.close(); }
	});
});

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
