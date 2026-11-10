import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { gitCwd, inspectArgs, type GitReadCommand } from "./git-inspect.ts";
import { argumentTier, destructiveRefspec, parseGitArguments, type GitArguments, type GitTier } from "./git-risk.ts";
import { runGit, type GitRunner, type GitRunOptions } from "./git-runner.ts";

export interface GitPlan {
	cwd: string;
	args: string[];
	command: string;
	tier: GitTier;
	readonly: boolean;
	repository: string;
	gitDir: string;
	commonDir: string;
	scope: string[];
	network: string[];
	fingerprint: string;
}

/** Resolve without contacting remotes. Raw configuration is hashed, never exposed in the gate. */
export async function planGit(base: string, input: { args: string[]; cwd?: string }, options: GitRunOptions, runner: GitRunner = runGit): Promise<GitPlan> {
	const parsed = parseGitArguments(input.args);
	const cwd = await gitCwd(base, input.cwd);
	const probe = async (args: string[], optional = false): Promise<string> => {
		const result = await runner(cwd, args, { ...options, readonly: true, metadata: true });
		if (result.exitCode !== 0) {
			if (optional && [1, 128].includes(result.exitCode)) return "";
			throw new Error(`GIT_PREFLIGHT_FAILED: ${args[0]} 无法读取仓库信息（exit ${result.exitCode}）`);
		}
		return result.fullOutputPath ? readFile(result.fullOutputPath, "utf8") : result.output;
	};
	const [builtinText, directoryText] = await settledProbes([probe(["--list-cmds=builtins"]), probe(["rev-parse", "--absolute-git-dir"], true)]);
	const builtins = builtinText.split(/\s+/);
	if (!builtins.includes(parsed.command)) throw new Error("GIT_COMMAND_UNSUPPORTED: 请使用内置 Git 子命令；别名和外部 git-* 扩展无法按实际动作分档");
	const gitDirText = directoryText.trim();
	if (!gitDirText) {
		// init/clone are legitimate outside a repository. Treat the cwd as a command
		// scope, not an exact list of written files; readonly tasks reject these.
		if (!["init", "clone", "version"].includes(parsed.command)) throw new Error("GIT_NOT_REPOSITORY: cwd 不是 Git 仓库");
		return { cwd, args: [...input.args], command: parsed.command, tier: "reversible", readonly: parsed.command === "version", repository: cwd, gitDir: cwd, commonDir: cwd, scope: [cwd], network: [], fingerprint: cwd };
	}
	const gitDir = await realpath(gitDirText);
	// Independent readonly probes share no mutable state. Wait for every process even
	// on failure so no probe outlives this preflight or a subsequent approval decision.
	const [commonText, rootText, configText, refs, branchText, headText] = await settledProbes([
		probe(["rev-parse", "--git-common-dir"]), probe(["rev-parse", "--show-toplevel"], true),
		probe(["config", "--null", "--list", "--includes"]), probe(["for-each-ref", "--format=%(refname)%00%(objectname)"]),
		probe(["symbolic-ref", "--quiet", "--short", "HEAD"], true), probe(["rev-parse", "--verify", "HEAD"], true),
	]);
	const commonDir = await realpath(resolve(cwd, commonText.trim()));
	const root = rootText.trim();
	const repository = root ? await realpath(root) : commonDir;
	const config = configMap(configText);
	const branch = branchText.trim();
	const head = headText.trim();
	let tier = argumentTier(input.args, parsed);
	if (parsed.command === "checkout" && parsed.operands.length === 1 && !["create", "force-create", "orphan"].some((name) => parsed.flags.has(name))) {
		const revision = parsed.operands[0];
		const commit = await probe(["rev-parse", "--verify", "--end-of-options", `${revision === "-" ? "@{-1}" : revision}^{commit}`], true);
		const remoteMatches = refs.split("\n").filter((line) => line.startsWith("refs/remotes/") && line.split("\0")[0].endsWith(`/${revision}`));
		const paths = commit ? "" : await probe(["ls-files", "-z", "--", revision]);
		const guess = parsed.flags.get("guess") ?? last(config, "checkout.guess");
		if (!commit && (paths || guess === false || guess === "false" || remoteMatches.length !== 1)) tier = "irreversible";
	}
	let readonly = false;
	let args = [...input.args];
	if (["status", "log", "diff", "show", "branch"].includes(parsed.command)) {
		const branchLists = parsed.command !== "branch" || parsed.operands.length + parsed.paths.length === 0 || ["list", "all", "remotes", "contains", "merged", "points-at", "show-current"].some((name) => parsed.flags.has(name));
		if (branchLists) {
			try { args = inspectArgs(parsed.command as GitReadCommand, input.args.slice(1)); readonly = true; }
			catch { /* Worker can use mutating forms; a readonly task will refuse them. */ }
		}
	}
	const scope = [...new Set([repository, gitDir, commonDir])];
	let network: string[] = [];
	let remoteSnapshot = "";
	if (["push", "fetch", "pull"].includes(parsed.command)) {
		const remotes = (await probe(["remote"])).trim().split(/\r?\n/).filter(Boolean);
		const resolution = await resolveRemotes(parsed, config, branch, remotes, probe, cwd);
		remoteSnapshot = JSON.stringify(resolution);
		network = resolution.urls.map(hostname).filter((host): host is string => Boolean(host));
		scope.push(...resolution.urls.map(displayRemote));
		if (parsed.command === "push") {
			if (resolution.destructive) tier = "irreversible";
			scope.push(`refs: ${resolution.refspecs.length ? resolution.refspecs.join(", ") : `Git 默认推送规则（当前分支 ${branch || "detached"}）`}`);
		}
	}
	const pathspecFile = parsed.flags.get("pathspec-from-file");
	let pathspecContents = "";
	if (typeof pathspecFile === "string") {
		if (pathspecFile === "-") throw new Error("GIT_ARGUMENT_UNSUPPORTED: 工具不接受从 stdin 读取 pathspec；请传具体路径或文件");
		const file = resolve(cwd, pathspecFile); pathspecContents = (await readFile(file)).toString("base64"); scope.push(file);
	}
	const identity = await Promise.all([repository, gitDir, commonDir].map(async (path) => { const info = await stat(path); return [path, info.dev, info.ino]; }));
	const fingerprint = createHash("sha256").update(JSON.stringify([cwd, identity, configText, refs, head, branch, remoteSnapshot, pathspecContents, args, tier])).digest("hex");
	return { cwd, args, command: parsed.command, tier, readonly, repository, gitDir, commonDir, scope: [...new Set(scope)], network: [...new Set(network)], fingerprint };
}

type Config = Map<string, string[]>;
async function settledProbes(probes: Promise<string>[]): Promise<string[]> {
	const results = await Promise.allSettled(probes);
	return results.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
}
function configMap(text: string): Config {
	const result: Config = new Map();
	for (const entry of text.split("\0")) {
		if (!entry) continue;
		const newline = entry.indexOf("\n"); const key = newline < 0 ? entry : entry.slice(0, newline); const value = newline < 0 ? "true" : entry.slice(newline + 1);
		result.set(key, [...result.get(key) ?? [], value]);
	}
	return result;
}
function last(config: Config, key: string): string | undefined { return config.get(key)?.at(-1); }
type Probe = (args: string[], optional?: boolean) => Promise<string>;

async function resolveRemotes(parsed: GitArguments, config: Config, branch: string, remotes: string[], probe: Probe, cwd: string) {
	const push = parsed.command === "push";
	let names: string[];
	let refspecs: string[] = [];
	if (push) {
		const repoOption = parsed.flags.get("repo");
		const positional = [...parsed.operands, ...parsed.paths];
		// Git's positional repository overrides --repo; subsequent operands are refspecs.
		names = [positional.shift() || (typeof repoOption === "string" ? repoOption : undefined) || last(config, `branch.${branch}.pushremote`) || last(config, "remote.pushdefault") || last(config, `branch.${branch}.remote`) || (remotes.length === 1 ? remotes[0] : "origin")];
		refspecs = positional;
		const recurse = parsed.flags.get("recurse-submodules") ?? last(config, "push.recursesubmodules") ?? last(config, "submodule.recurse");
		if (recurse && recurse !== "no" && recurse !== "false" && recurse !== "check") throw new Error("GIT_ARGUMENT_UNSUPPORTED: 请逐个子模块执行 push，以便分别核对远端和风险档");
	} else {
		const operands = [...parsed.operands, ...parsed.paths];
		if (parsed.flags.get("all") === true || parsed.flags.get("multiple") === true || (!operands.length && parsed.flags.get("all") !== false && truthy(last(config, "fetch.all")))) names = operands.length ? operands : remotes.filter((name) => !truthy(last(config, `remote.${name}.skipfetchall`)));
		else names = [operands[0] || last(config, `branch.${branch}.remote`) || (remotes.length === 1 ? remotes[0] : "origin")];
	}
	const urls: string[] = [];
	let destructive = false;
	for (const name of names) {
		if (config.has(`remotes.${name}`)) throw new Error("GIT_ARGUMENT_UNSUPPORTED: 请逐个远端调用，不能把远端组作为单个已核对的目标");
		if (remotes.includes(name)) {
			if (push && truthy(last(config, `remote.${name}.mirror`))) destructive = true;
			if (push && !refspecs.length && !["tags", "all", "branches", "mirror"].some((key) => parsed.enabled.has(key))) refspecs = config.get(`remote.${name}.push`) ?? [];
			if (push && parsed.enabled.has("tags")) refspecs.push("refs/tags/*");
			if (push && (parsed.enabled.has("all") || parsed.enabled.has("branches"))) refspecs.push("refs/heads/*");
			if (push && (parsed.enabled.has("mirror") || truthy(last(config, `remote.${name}.mirror`)))) refspecs.push("refs/* (mirror)");
			const result = await probe(["remote", "get-url", ...(push ? ["--push"] : []), "--all", name]);
			urls.push(...result.trim().split(/\r?\n/).filter(Boolean));
		} else {
			// Legacy .git/remotes and .git/branches can supply hidden refspecs. Refuse
			// opaque names; accept explicit URLs and paths without reading legacy files.
			if (!/[/:\\]/.test(name) && name !== ".") throw new Error("GIT_REMOTE_UNRESOLVED: 请配置命名远端或提供明确 URL/路径");
			const url = (push ? rewriteUrl(name, "pushinsteadof", config) : undefined) ?? rewriteUrl(name, "insteadof", config) ?? name;
			urls.push(!url.includes(":") && !isAbsolute(url) ? resolve(cwd, url) : url);
		}
	}
	if (refspecs.some(destructiveRefspec)) destructive = true;
	return { urls, refspecs, destructive };
}
function truthy(value?: string): boolean { return value !== undefined && !["false", "no", "off", "0"].includes(value.toLowerCase()); }
/** Matches remote.c add_url_alias: longest prefix, push alias before regular alias; no recursive rewrite. */
function rewriteUrl(url: string, kind: string, config: Config): string | undefined {
	let length = -1; let rewritten: string | undefined;
	for (const [key, values] of config) if (key.startsWith("url.") && key.endsWith(`.${kind}`)) for (const value of values) {
		if (url.startsWith(value) && value.length > length) { length = value.length; rewritten = key.slice(4, -kind.length - 1) + url.slice(length); }
	}
	return rewritten;
}
export function displayRemote(value: string): string {
	try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
	catch { return value.replace(/^[^/@]+@(?=[^/]+:)/, ""); }
}
function hostname(value: string): string | undefined {
	if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return;
	if (/^(?:[^/@]+@)?[^/:]+:[^/]/.test(value) && !value.includes("::")) return /^(?:[^/@]+@)?([^/:]+):/.exec(value)?.[1];
	try { const url = new URL(value); return ["http:", "https:", "ssh:", "git:"].includes(url.protocol) ? url.hostname || undefined : undefined; }
	catch { return undefined; }
}
