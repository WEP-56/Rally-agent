import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { RoleWorkerExecutor } from "../../shared/role-workers.ts";

type ExternalExecutor = Exclude<RoleWorkerExecutor, "rally">;
const adapters: Record<ExternalExecutor, string> = {
	"claude-code": "@agentclientprotocol/claude-agent-acp",
	codex: "@agentclientprotocol/codex-acp",
};
const programs: Record<ExternalExecutor, { command: string; packageName: string }> = {
	"claude-code": { command: "claude", packageName: "@anthropic-ai/claude-code" },
	codex: { command: "codex", packageName: "@openai/codex" },
};

interface RuntimeOptions {
	agentDir: string;
	env: NodeJS.ProcessEnv;
	home?: string;
}

/** Use Rally's bundled ACP adapter with the host's existing CLI; never install at runtime. */
export function resolveExternalWorkerRuntime(executor: ExternalExecutor, options: RuntimeOptions): { entry: string; executable: string } {
	const { agentDir, env, home = homedir() } = options;
	const configPath = join(agentDir, "external-agents.json");
	const config = readConfiguration(configPath, executor);
	const variable = executor === "claude-code" ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH";
	const configured = config.executablePath ?? env[variable];
	let executable: string | undefined;
	if (configured !== undefined) {
		if (!isAbsolute(configured) || !isFile(configured)) throw new Error(`${executor} 的 executablePath / ${variable} 必须是现有文件的绝对路径，请检查 ${configPath}`);
		executable = normalizeExecutable(configured, executor);
	}
	const agentBin = join(agentDir, "bin");
	const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
	const pathDirectories = (env[pathKey] ?? "").split(delimiter).map(path => path.trim().replace(/^"(.*)"$/u, "$1"));
	const pathKeyOf = (path: string) => process.platform === "win32" ? normalize(path).toLowerCase() : normalize(path);
	// getShellEnv prepends Rally's bin. Existing host installations take priority over that legacy copy.
	const directories = pathDirectories.filter(path => pathKeyOf(path) !== pathKeyOf(agentBin));
	directories.push(join(home, ".local", "bin"));
	if (process.platform === "win32") directories.push(join(env.APPDATA ?? join(home, "AppData", "Roaming"), "npm"));
	const npmPrefix = env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX;
	if (npmPrefix && isAbsolute(npmPrefix)) directories.push(process.platform === "win32" ? npmPrefix : join(npmPrefix, "bin"));
	directories.push(agentBin);
	const searchDirectories = [...new Set(directories.filter(path => isAbsolute(path)))];
	const { command } = programs[executor];
	executable ??= findExecutable(executor, searchDirectories);

	// Keep installations made by older Rally versions usable, without requiring a new copy.
	const adapterPackage = adapters[executor];
	const legacy = config.adapterPath ?? join(agentDir, "external-agents", executor, "node_modules", adapterPackage, "dist", "index.js");
	if (!executable && isFile(legacy)) executable = legacyExecutable(legacy, executor);
	if (!executable) throw new Error(`当前任务运行主机未找到 ${command}。请先检查此账号已有的程序；安装在其它目录时，在 ${configPath} 设置 executablePath。只有确实未安装时才需要安装 CLI，可让 Rally 自我管理 Skill 协助检查。`);
	let entry: string;
	if (config.adapterPath !== undefined) {
		if (!isFile(config.adapterPath)) throw new Error(`${executor} 的 adapterPath 不存在，请检查 ${configPath}：${config.adapterPath}`);
		entry = normalizeProgram(config.adapterPath, adapterPackage, adapterPackage.split("/")[1]);
	} else {
		const adapterDir = env.RALLY_EXTERNAL_AGENTS_DIR ?? fileURLToPath(new URL("../../../build/external-agents/", import.meta.url));
		entry = join(adapterDir, executor, "index.js");
		if (!isFile(entry)) throw new Error(`已找到 ${command}：${executable}。Rally 内置连接组件缺失：${entry}。请修复或更新 Rally 安装，无需重新安装 ${command}。`);
	}
	return { entry, executable };
}

function legacyExecutable(entry: string, executor: ExternalExecutor): string | undefined {
	const adapterRequire = createRequire(entry);
	try {
		if (executor === "codex") {
			return normalizeExecutable(adapterRequire.resolve("@openai/codex/bin/codex.js"), executor);
		}
		const sdkRequire = createRequire(adapterRequire.resolve("@anthropic-ai/claude-agent-sdk"));
		const report = process.platform === "linux" ? process.report.getReport() as { header: { glibcVersionRuntime?: string } } : undefined;
		const musl = process.platform === "linux" && !report?.header.glibcVersionRuntime;
		const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl ? "-musl" : ""}`;
		const executable = sdkRequire.resolve(`${packageName}/claude${process.platform === "win32" ? ".exe" : ""}`);
		if (isFile(executable)) return executable;
	} catch { /* Report a useful setup error instead of the adapter's opaque startup failure. */ }
	return undefined;
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

function findExecutable(executor: ExternalExecutor, directories: string[]): string | undefined {
	const { command, packageName } = programs[executor];
	const names = process.platform === "win32" ? [`${command}.exe`, `${command}.cmd`, `${command}.ps1`, command] : [command];
	for (const directory of directories) {
		const candidates = names.map(name => join(directory, name));
		// npm links can be missing from PATH even though its global package is installed.
		for (const modules of [join(directory, "node_modules"), join(directory, "..", "lib", "node_modules")]) {
			const entry = manifestBin(join(modules, packageName, "package.json"), command);
			if (entry) candidates.push(entry);
		}
		for (const candidate of candidates) if (isFile(candidate)) {
			try { return normalizeExecutable(candidate, executor); }
			catch { /* A stale automatic candidate must not hide another working host installation. */ }
		}
	}
	return undefined;
}

function manifestBin(path: string, command: string): string | undefined {
	try {
		const manifest = JSON.parse(readFileSync(path, "utf8")) as { bin?: string | Record<string, string> };
		const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[command];
		const entry = bin && join(dirname(path), bin);
		return entry && isFile(entry) ? realpathSync(entry) : undefined;
	} catch { return undefined; }
}

function packageBin(from: string, packageName: string, command: string): string | undefined {
	try { return manifestBin(createRequire(from).resolve(`${packageName}/package.json`), command); }
	catch { return undefined; }
}

function normalizeProgram(path: string, packageName: string, command: string): string {
	const actual = realpathSync(path);
	const shim = /\.(?:cmd|ps1)$/iu.test(actual);
	if (shim || (process.platform === "win32" && basename(actual) === command)) {
		const entry = packageBin(actual, packageName, command);
		if (entry) return entry;
		if (shim) throw new Error(`${command} 的 npm 启动脚本没有对应程序，请检查安装或指定实际入口：${path}`);
	}
	return actual;
}

function normalizeExecutable(path: string, executor: ExternalExecutor): string {
	const { packageName, command } = programs[executor];
	let executable = normalizeProgram(path, packageName, command);
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
