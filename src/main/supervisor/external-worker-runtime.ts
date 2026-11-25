import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { RoleWorkerExecutor } from "../../shared/role-workers.ts";

type ExternalExecutor = Exclude<RoleWorkerExecutor, "rally">;
const adapters: Record<ExternalExecutor, string> = {
	"claude-code": "@agentclientprotocol/claude-agent-acp",
	codex: "@agentclientprotocol/codex-acp",
};

interface RuntimeOptions {
	agentDir: string;
	env: NodeJS.ProcessEnv;
	home?: string;
}

/** Resolve user-owned programs only. Opening the model picker never installs anything. */
export function resolveExternalWorkerRuntime(executor: ExternalExecutor, options: RuntimeOptions): { entry: string; executable: string } {
	const { agentDir, env, home = homedir() } = options;
	const configPath = join(agentDir, "external-agents.json");
	const config = readConfiguration(configPath, executor);
	const entry = config.adapterPath ?? join(agentDir, "external-agents", executor, "node_modules", adapters[executor], "dist", "index.js");
	if (!isAbsolute(entry) || !isFile(entry)) {
		throw new Error(`${executor} 尚未配置接入组件。可让 Rally 使用自我管理 Skill 安装或连接已有程序。适配器路径：${entry}；配置文件：${configPath}`);
	}
	const variable = executor === "claude-code" ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH";
	const configured = config.executablePath ?? env[variable];
	if (configured !== undefined) {
		if (!isAbsolute(configured) || !isFile(configured)) throw new Error(`${executor} 的 executablePath / ${variable} 必须是现有文件的绝对路径，请检查 ${configPath}`);
		return { entry, executable: normalizeExecutable(configured, executor) };
	}

	const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
	const pathDirectories = (env[pathKey] ?? "").split(process.platform === "win32" ? ";" : ":");
	const directories = [join(agentDir, "bin"), ...pathDirectories, join(home, ".local", "bin")];
	if (process.platform === "win32" && env.APPDATA) directories.push(join(env.APPDATA, "npm"));
	const command = executor === "claude-code" ? "claude" : "codex";
	const names = process.platform === "win32" ? [`${command}.exe`, `${command}.cmd`, `${command}.ps1`, command] : [command];
	for (const directory of new Set(directories.filter(path => isAbsolute(path)))) {
		for (const name of names) {
			const candidate = join(directory, name);
			if (isFile(candidate)) return { entry, executable: normalizeExecutable(candidate, executor) };
		}
	}

	// A user may explicitly install the adapter with its native optional dependencies.
	// Those live in the persistent user directory, never in Rally's release packages.
	const adapterRequire = createRequire(entry);
	try {
		if (executor === "codex") {
			return { entry, executable: normalizeExecutable(adapterRequire.resolve("@openai/codex/bin/codex.js"), executor) };
		}
		const sdkRequire = createRequire(adapterRequire.resolve("@anthropic-ai/claude-agent-sdk"));
		const report = process.platform === "linux" ? process.report.getReport() as { header: { glibcVersionRuntime?: string } } : undefined;
		const musl = process.platform === "linux" && !report?.header.glibcVersionRuntime;
		const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl ? "-musl" : ""}`;
		const executable = sdkRequire.resolve(`${packageName}/claude${process.platform === "win32" ? ".exe" : ""}`);
		if (isFile(executable)) return { entry, executable };
	} catch { /* Report a useful setup error instead of the adapter's opaque startup failure. */ }
	throw new Error(`当前任务主机未找到 ${command}。可让 Rally 使用自我管理 Skill 按需安装，或在 ${configPath} 设置 executablePath 复用已有程序。`);
}

function readConfiguration(path: string, executor: ExternalExecutor): { adapterPath?: string; executablePath?: string } {
	if (!existsSync(path)) return {};
	let source: unknown;
	try { source = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/u, "")); }
	catch { throw new Error(`无法读取外部执行器配置，请检查 ${path} 的 JSON 格式`); }
	if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`外部执行器配置必须是 JSON 对象：${path}`);
	const value = (source as Record<string, unknown>)[executor];
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 的 ${executor} 必须是对象`);
	const config = value as Record<string, unknown>;
	for (const key of ["adapterPath", "executablePath"]) {
		if (config[key] !== undefined && (typeof config[key] !== "string" || !isAbsolute(config[key]))) {
			throw new Error(`${path} 的 ${executor}.${key} 必须是绝对路径`);
		}
	}
	return { adapterPath: config.adapterPath as string | undefined, executablePath: config.executablePath as string | undefined };
}

function normalizeExecutable(path: string, executor: ExternalExecutor): string {
	let executable = realpathSync(path);
	if (/\.(?:cmd|ps1)$/iu.test(executable)) {
		// Resolve npm's Windows shim without invoking a shell or needing node on PATH.
		const packageName = executor === "claude-code" ? "@anthropic-ai/claude-code" : "@openai/codex";
		try {
			const manifestPath = createRequire(executable).resolve(`${packageName}/package.json`);
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: string | Record<string, string> };
			const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[executor === "claude-code" ? "claude" : "codex"];
			if (!bin) throw new Error("Missing npm bin entry");
			executable = join(dirname(manifestPath), bin);
		}
		catch { throw new Error(`${executor} 的 npm 安装不完整或不是标准启动脚本，请设置实际程序的 executablePath：${path}`); }
	}
	if (executor === "codex" && /\.[cm]?js$/iu.test(executable) && isFile(executable)) {
		const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`;
		const packageRoot = dirname(dirname(executable));
		let nativeRoot = packageRoot;
		try { nativeRoot = dirname(createRequire(executable).resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`)); }
		catch { /* Older Codex installs place vendor directly in the CLI package. */ }
		executable = join(nativeRoot, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex");
	}
	if (!isFile(executable)) throw new Error(`${executor} 的安装不完整，找不到实际程序：${executable}；请修复安装或设置 executablePath`);
	return executable;
}

function isFile(path: string): boolean {
	try { return statSync(path).isFile(); }
	catch { return false; }
}
