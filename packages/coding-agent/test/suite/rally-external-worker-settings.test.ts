import { chmodSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	const adapterDir = join(root, "bundled");
	return {
		root, file,
		bundled: (executor: string) => file(join(adapterDir, executor, "index.js")),
		options: { agentDir: root, env: { RALLY_EXTERNAL_AGENTS_DIR: adapterDir }, home: root },
	};
}

describe("external worker runtime discovery", () => {
	it("reports the missing host CLI without installing anything or searching application dependencies", () => {
		const { root, options } = runtimeFixture();
		expect(() => resolveExternalWorkerRuntime("codex", options)).toThrow(/自我管理 Skill/);
		expect(readdirSync(root)).toEqual([]);
	});

	it("prefers existing host programs over legacy Rally copies even when its bin was prepended", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const entry = bundled("codex");
		const name = process.platform === "win32" ? "codex.exe" : "codex";
		const legacy = file(join(root, "bin", name));
		const executable = file(join(root, "path", name));
		const env = { ...options.env, Path: [join(root, "bin"), join(root, "path")].join(process.platform === "win32" ? ";" : ":") };
		expect(resolveExternalWorkerRuntime("codex", { ...options, env })).toEqual({ entry, executable });
		rmSync(executable);
		expect(resolveExternalWorkerRuntime("codex", { ...options, env }).executable).toBe(legacy);
	});

	it("uses the bundled adapter even when another version is installed globally", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const bin = join(root, "existing", "bin");
		const modules = process.platform === "win32" ? join(bin, "node_modules") : join(root, "existing", "lib", "node_modules");
		file(join(modules, "@agentclientprotocol/codex-acp/package.json"), '{"bin":{"codex-acp":"dist/index.js"}}');
		const globalAdapter = file(join(modules, "@agentclientprotocol/codex-acp/dist/index.js"));
		const entry = bundled("codex");
		const executable = file(join(bin, process.platform === "win32" ? "codex.exe" : "codex"));
		if (process.platform === "win32") file(join(bin, "codex-acp.cmd"));
		else symlinkSync(globalAdapter, join(bin, "codex-acp"));
		expect(resolveExternalWorkerRuntime("codex", { ...options, env: { ...options.env, PATH: bin } })).toEqual({ entry, executable });
		expect(readdirSync(root)).toEqual(["bundled", "existing"]);
	});

	it("reports a damaged Rally installation when its bundled adapter is missing", () => {
		const { root, file, options } = runtimeFixture();
		const executable = file(join(root, ".local/bin", process.platform === "win32" ? "claude.exe" : "claude"));
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(`已找到 claude：${executable}`);
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/请修复或更新 Rally 安装/);
		expect(readdirSync(root)).toEqual([".local"]);
	});

	it("connects an explicit CLI outside PATH through the bundled adapter", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const prefix = join(root, "custom-prefix");
		const executable = file(join(prefix, "node_modules/@anthropic-ai/claude-code/cli.js"));
		const entry = bundled("claude-code");
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { executablePath: executable } }));
		expect(resolveExternalWorkerRuntime("claude-code", options)).toEqual({ entry, executable });
	});

	it("continues automatic discovery after a stale npm shim", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const broken = join(root, "broken");
		const usable = join(root, "usable");
		file(join(broken, process.platform === "win32" ? "codex.cmd" : "codex"), "fixture");
		if (process.platform !== "win32") {
			rmSync(join(broken, "codex"));
			symlinkSync(join(broken, "missing"), join(broken, "codex"));
		}
		const executable = file(join(usable, process.platform === "win32" ? "codex.exe" : "codex"));
		const entry = bundled("codex");
		const env = { ...options.env, PATH: [broken, usable].join(process.platform === "win32" ? ";" : ":") };
		expect(resolveExternalWorkerRuntime("codex", { ...options, env })).toEqual({ entry, executable });
	});

	it.skipIf(process.platform !== "win32")("finds npm packages in the user's AppData when a desktop PATH is stale", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const prefix = join(root, "AppData/Roaming/npm"), modules = join(prefix, "node_modules");
		const entry = bundled("claude-code");
		file(join(modules, "@anthropic-ai/claude-code/package.json"), '{"bin":{"claude":"bin/claude.exe"}}');
		const executable = file(join(modules, "@anthropic-ai/claude-code/bin/claude.exe"));
		expect(resolveExternalWorkerRuntime("claude-code", options)).toEqual({ entry, executable });
	});

	it("reuses configured adapters and executables, and rejects broken explicit paths instead of silently switching", () => {
		const { root, file, options } = runtimeFixture();
		const entry = file(join(root, "existing-adapter/index.js"));
		const executable = file(join(root, "existing-cli/claude.exe"));
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: entry, executablePath: executable } }));
		expect(resolveExternalWorkerRuntime("claude-code", { ...options, env: { CLAUDE_CODE_EXECUTABLE: "ignored" } })).toEqual({ entry, executable });
		rmSync(executable);
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/executablePath/);
		file(executable);
		rmSync(entry);
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/adapterPath 不存在/);
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: "relative/index.js" } }));
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/绝对路径/);
		file(join(root, "external-agents.json"), "not json");
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/JSON/);
	});

	it("honors the host CLI environment override and finds native user installs without it", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const entry = bundled("claude-code");
		const executable = file(join(root, ".local/bin", process.platform === "win32" ? "claude.exe" : "claude"));
		expect(resolveExternalWorkerRuntime("claude-code", options)).toEqual({ entry, executable });
		const override = file(join(root, "explicit-claude"));
		expect(resolveExternalWorkerRuntime("claude-code", { ...options, env: { ...options.env, CLAUDE_CODE_EXECUTABLE: override } }).executable).toBe(override);
		rmSync(executable);
		expect(() => resolveExternalWorkerRuntime("claude-code", options)).toThrow(/未找到 claude/);
	});

	it("keeps a legacy Codex CLI usable with the new bundled adapter", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const modules = join(root, "external-agents/codex/node_modules");
		file(join(modules, "@agentclientprotocol/codex-acp/dist/index.js"));
		const entry = bundled("codex");
		file(join(modules, "@openai/codex/package.json"), '{"name":"@openai/codex","bin":{"codex":"bin/codex.js"}}');
		file(join(modules, "@openai/codex/bin/codex.js"));
		const native = join(modules, `@openai/codex-${process.platform}-${process.arch}`);
		file(join(native, "package.json"), '{"name":"@openai/codex"}');
		const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`;
		const executable = file(join(native, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex"));
		expect(resolveExternalWorkerRuntime("codex", options)).toEqual({ entry, executable });
		if (process.platform === "win32") {
			const shim = file(join(modules, ".bin/codex.cmd"));
			expect(resolveExternalWorkerRuntime("codex", { ...options, env: { ...options.env, CODEX_PATH: shim } })).toEqual({ entry, executable });
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

	it("keeps a legacy Claude SDK CLI usable with the new bundled adapter", () => {
		const { root, file, bundled, options } = runtimeFixture();
		const modules = join(root, "external-agents/claude-code/node_modules");
		file(join(modules, "@agentclientprotocol/claude-agent-acp/dist/index.js"));
		const entry = bundled("claude-code");
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

	it("starts the bundled ACP entry with the selected host CLI without a model request", async () => {
		const { root, file } = runtimeFixture();
		const executable = file(join(root, "cli/claude.exe"));
		file(join(root, "bundled/package.json"), '{"type":"module"}');
		file(join(root, "bundled/claude-code/index.js"), `
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
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { executablePath: executable } }));
		vi.stubEnv("RALLY_EXTERNAL_AGENTS_DIR", join(root, "bundled"));
		vi.stubEnv("RALLY_CODING_AGENT_DIR", root);
		vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "empty-profile"));
		const session = await ExternalWorkerSession.start({ executor: "claude-code", cwd: root, mode: "readonly" });
		try { expect(session.models).toEqual([{ id: "fixture", name: executable }]); }
		finally { await session.close(); }
	});

	it.skipIf(process.platform === "win32")("launches an existing native adapter directly", async () => {
		const { root, file } = runtimeFixture();
		const executable = file(join(root, "claude"));
		const entry = file(join(root, "claude-agent-acp"), `#!${process.execPath}
const { createInterface } = require('node:readline');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === 'initialize'
    ? { protocolVersion: request.params.protocolVersion, agentCapabilities: {} }
    : request.method === 'session/new'
      ? { sessionId: 'native', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fixture', options: [{ value: 'fixture', name: 'Native adapter' }] }] }
      : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`);
		chmodSync(entry, 0o755);
		file(join(root, "external-agents.json"), JSON.stringify({ "claude-code": { adapterPath: entry, executablePath: executable } }));
		vi.stubEnv("RALLY_CODING_AGENT_DIR", root);
		vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "empty-profile"));
		const session = await ExternalWorkerSession.start({ executor: "claude-code", cwd: root, mode: "readonly" });
		try { expect(session.models).toEqual([{ id: "fixture", name: "Native adapter" }]); }
		finally { await session.close(); }
	});

	it.each([
		{ auth: "legacy", failure: undefined },
		{ auth: "authenticated", failure: undefined },
		{ auth: "unauthenticated", failure: "请先在当前主机登录 Codex" },
		{ auth: "failure", failure: "fixture auth failure" },
		{ auth: "legacy-unauthenticated", failure: "请先在当前主机登录 Codex" },
	])("checks existing Codex adapters with $auth authentication without sending prompts", async ({ auth, failure }) => {
		const { root, file } = runtimeFixture();
		const executable = file(join(root, "codex.exe"));
		const entry = file(join(root, "adapter/index.mjs"), `
import { createInterface } from 'node:readline';
const auth = ${JSON.stringify(auth)};
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result, error;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, agentCapabilities: {} };
  else if (request.method === 'auth/status') {
    if (auth.startsWith('legacy')) error = { code: -32601, message: 'Method not found' };
    else if (auth === 'failure') error = { code: -32603, message: 'fixture auth failure' };
    else result = { state: auth };
  } else if (request.method === 'session/new') {
    if (auth === 'legacy-unauthenticated') error = { code: -32000, message: 'Authentication required' };
    else result = { sessionId: 'offline', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fixture', options: [{ value: 'fixture', name: 'Existing Codex' }] }] };
  } else if (request.method === 'session/close') result = {};
  else throw new Error('Unexpected request: ' + request.method);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) }) + '\\n');
});
`);
		file(join(root, "external-agents.json"), JSON.stringify({ codex: { adapterPath: entry, executablePath: executable } }));
		vi.stubEnv("RALLY_CODING_AGENT_DIR", root);
		if (failure) await expect(ExternalWorkerSession.start({ executor: "codex", cwd: root, mode: "readonly" })).rejects.toThrow(failure);
		else {
			const session = await ExternalWorkerSession.start({ executor: "codex", cwd: root, mode: "readonly" });
			try { expect(session.models).toEqual([{ id: "fixture", name: "Existing Codex" }]); }
			finally { await session.close(); }
		}
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
