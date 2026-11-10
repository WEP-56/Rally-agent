import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "../../src/index.ts";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { createGitTool } from "../../../../src/main/supervisor/git-tool.ts";
import { argumentTier, parseGitArguments } from "../../../../src/main/supervisor/git-risk.ts";
import { planGit } from "../../../../src/main/supervisor/git-plan.ts";
import { runGit, type GitRunner } from "../../../../src/main/supervisor/git-runner.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally worker Git (offline gates and local repositories)", () => {
	const harnesses: Harness[] = []; const services: GateService[] = [];
	afterEach(() => {
		vi.restoreAllMocks(); vi.unstubAllEnvs();
		for (const service of services.splice(0)) service.dispose();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(mode: "readonly" | "write" = "write") {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
		const cwd = join(harness.tempDir, "project"); mkdirSync(cwd);
		execFileSync("git", ["init", cwd], { windowsHide: true, stdio: "ignore" });
		const config = (key: string, value: string) => execFileSync("git", ["-C", cwd, "config", "--add", key, value], { windowsHide: true });
		config("remote.origin.url", "https://user:secret@source.example/repo.git");
		const events = new EventLog(paths.eventsFile); const store = new TaskStore(events, paths.workspaceDir, () => {}); const audit = new AuditLog(paths.auditFile, events);
		const gates = new GateService({ store, audit, events, requested: () => {}, notice: () => {}, quote: (ref) => ref.id === "#allowed" ? { messageId: ref.id } : null }); services.push(gates);
		const task = store.create({ title: "git fixture", cwd, mode, scope: [], dependsOn: [], quotes: [], autoApprove: true }).task;
		const run = store.startRun(task.id, "dispatch", "faux"); mkdirSync(task.outputDir, { recursive: true });
		const host = { task, run, store, gates, audit, isActive: () => !task.ended && !run.endedAt };
		const executed: { cwd: string; args: readonly string[] }[] = [];
		const runner: GitRunner = async (dir, args, options) => {
			if (options.metadata) return runGit(dir, args, options);
			executed.push({ cwd: dir, args: [...args] }); return { exitCode: 0, output: "fixture execution" };
		};
		const tool = createGitTool(host, runner); let sequence = 0;
		const call = (input: Parameters<typeof tool.execute>[1], signal?: AbortSignal) => tool.execute(`git-${++sequence}`, input, signal, undefined, {} as ExtensionToolContext);
		const decide = async (value: "allow" | "deny" = "allow") => {
			await vi.waitFor(() => expect(task.gates?.some((gate) => !gate.decision)).toBe(true), { timeout: 10000 });
			const gate = task.gates!.find((item) => !item.decision)!;
			gates.decide(gate.id, value, "main", value === "allow" ? [{ id: "#allowed" }] : [], "fixture decision"); return gate;
		};
		return { paths, cwd, config, events, store, audit, gates, task, run, host, executed, call, decide, runner };
	}

	it.each([
		["reset", "--hard"], ["checkout", "-qf", "main"], ["checkout", "--", "file"], ["checkout", "HEAD", "file"], ["switch", "--discard-changes", "main"], ["switch", "-f", "main"],
		["restore", "file"], ["restore", "-SW", "file"], ["restore", "--staged", "--no-staged", "file"], ["clean", "-n"], ["push", "--force", "origin"], ["push", "-qf", "origin"],
		["push", "--force-with-lease=refs/heads/main:abc", "origin"], ["push", "origin", "+HEAD:main"], ["push", "origin", ":old"], ["push", "--delete", "origin", "old"], ["push", "--mirror"], ["push", "--prune"],
		["branch", "-D", "old"], ["branch", "-df", "old"], ["stash", "drop"], ["stash", "clear"], ["reflog", "expire", "--all"], ["gc", "--prune=now"], ["gc"],
	])("classifies destructive argv %j without executing it", (...args) => expect(argumentTier(args)).toBe("irreversible"));

	it.each([
		["reset", "--soft", "HEAD~1"], ["checkout", "main"], ["switch", "main"], ["restore", "--staged", "file"], ["branch", "-d", "old"], ["stash", "push", "-m", "note"], ["stash", "pop"],
		["add", "--", "file"], ["commit", "-m", "message --force"], ["merge", "feature"], ["rebase", "main"], ["gc", "--no-prune"], ["fetch", "origin"], ["pull", "--ff-only"], ["tag", "name"],
	])("retains reversible argv %j", (...args) => expect(argumentTier(args)).toBe("reversible"));
	it.each([["push"], ["push", "--tags"], ["push", "--push-option=--force", "origin", "main"]])("keeps ordinary pushes external %j", (...args) => expect(argumentTier(args)).toBe("external"));
	it.each([["-C", "repo", "push"], ["push", "--forc"], ["checkout", "--pathspec-from-file", "--", "-f"], ["push", "--repo", "--", "--force"], ["gc", "--prun=now"]])("refuses unknown or ambiguous argument grammar %j", (...args) => expect(() => parseGitArguments(args)).toThrow("GIT_ARGUMENT"));

	it("parses values, combined short flags and a real path separator", () => {
		const parsed = parseGitArguments(["push", "-qu", "-o--force=as-data", "origin", "--", "+HEAD:main"]);
		expect(parsed.flags.get("push-option")).toBe("--force=as-data");
		expect(parsed.operands).toEqual(["origin"]); expect(parsed.paths).toEqual(["+HEAD:main"]);
	});

	it("gates checkout path mode, freezes args and uses the actual execution cwd", async () => {
		const { cwd, call, decide, task, executed, paths } = await setup();
		const sub = join(cwd, "sub"); mkdirSync(sub); writeFileSync(join(sub, "file"), "keep");
		const input = { args: ["checkout", "."], cwd: sub }; const pending = call(input); input.args.push("unapproved");
		const gate = await decide(); expect(executed).toEqual([]); expect(gate.cwd).toBe(sub); expect(gate.scope).toContain(cwd); expect(gate.arguments.args).toEqual(["checkout", "."]);
		expect((await pending).details.exitCode).toBe(0); expect(executed).toEqual([{ cwd: sub, args: ["checkout", "."] }]);
		expect(readFileSync(join(sub, "file"), "utf8")).toBe("keep"); expect(task.gates![0].decision?.basis).toEqual(["#allowed"]);
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"exitCode":0');
	}, 15000);

	it.each(["mirror", "refspec"])("detects destructive push from %s configuration and redacts stored credentials", async (kind) => {
		const { config, call, decide, executed, paths } = await setup();
		config(kind === "mirror" ? "remote.origin.mirror" : "remote.origin.push", kind === "mirror" ? "true" : "+HEAD:refs/heads/main");
		const pending = call({ args: ["push"] }); const gate = await decide(); expect(executed).toHaveLength(0);
		expect(gate.scope.some((entry) => entry.includes("source.example"))).toBe(true); expect(JSON.stringify(gate)).not.toContain("secret");
		await pending; expect(readFileSync(paths.auditFile, "utf8")).not.toContain("secret");
	}, 15000);

	it("records a normal push's notice, audit and resolved push hosts without a gate", async () => {
		const { config, call, task, store, executed, paths } = await setup();
		config("remote.origin.pushurl", "ssh://git@push.example/repo.git"); config("remote.origin.pushurl", "https://backup.example/repo.git");
		await call({ args: ["push", "--tags"] }); expect(task.gates).toBeUndefined(); expect(executed).toHaveLength(1);
		expect(store.access(task.id).filter((item) => item.kind === "net").map((item) => item.target)).toEqual(["push.example", "backup.example"]);
		expect(store.access(task.id)[0]).toMatchObject({ kind: "fs_write", coverage: "command_scope", outcome: "attempt" }); expect(task.changedFiles ?? []).toEqual([]);
		const audit = readFileSync(paths.auditFile, "utf8"); expect(audit).toContain('"kind":"external"'); expect(audit).toContain('"result":"attempt"'); expect(audit).toContain('"result":"finished"');
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.access(task.id)).toEqual(store.access(task.id)); expect(restored.get(task.id)?.changedFiles ?? []).toEqual([]);
		expect(readTask(restored, restored.get(task.id)!, { view: "files" })).toMatchObject({ coverage: { git: "attempted repository command scope; not exact changed files" } });
	}, 15000);

	it("treats push --tags as external when it replaces a configured force refspec", async () => {
		const { cwd, config, task } = await setup(); config("remote.origin.push", "+HEAD:refs/heads/main");
		const plan = await planGit(cwd, { args: ["push", "--tags", "origin"] }, { outputDir: task.outputDir });
		expect(plan.tier).toBe("external"); expect(plan.scope).toContain("refs: refs/tags/*");
	});

	it("resolves branch pushRemote, URL rewriting, --repo and fetch option values", async () => {
		const { cwd, config, task } = await setup();
		const branch = execFileSync("git", ["-C", cwd, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
		config("remote.second.url", "https://second.example/repo"); config(`branch.${branch}.pushRemote`, "second");
		config("url.ssh://git@rewritten.example/.pushInsteadOf", "https://source.example/");
		const opts = { outputDir: task.outputDir };
		expect((await planGit(cwd, { args: ["push"] }, opts)).network).toEqual(["second.example"]);
		const explicit = await planGit(cwd, { args: ["push", "--repo=second", "https://source.example/repo", "+HEAD:main"] }, opts);
		expect(explicit.tier).toBe("irreversible"); expect(explicit.network).toEqual(["rewritten.example"]);
		expect((await planGit(cwd, { args: ["push", "--repo=https://source.example/repo"] }, opts)).network).toEqual(["rewritten.example"]);
		expect((await planGit(cwd, { args: ["fetch", "--depth", "1", "second"] }, opts)).network).toEqual(["second.example"]);
	}, 15000);

	it("covers fetch.all configuration and keeps configured skipped remotes out of its attempt scope", async () => {
		const { cwd, config, task } = await setup();
		config("remote.second.url", "git@second.example:repo.git"); config("remote.skipped.url", "https://skipped.example/repo");
		config("remote.skipped.skipFetchAll", "true"); config("fetch.all", "true");
		const options = { outputDir: task.outputDir };
		expect((await planGit(cwd, { args: ["fetch"] }, options)).network).toEqual(["source.example", "second.example"]);
		expect((await planGit(cwd, { args: ["fetch", "--no-all", "origin"] }, options)).network).toEqual(["source.example"]);
	}, 15000);

	it("keeps metadata in memory and separates stderr warnings from machine-readable stdout", async () => {
		const { cwd, task } = await setup();
		const script = join(task.outputDir, "probe.cjs");
		writeFileSync(script, "process.stdout.write('value'.repeat(8000)); process.stderr.write('warning');");
		const result = await runGit(cwd, ["-c", `alias.probe=!\"${process.execPath.replaceAll("\\", "/")}\" \"${script.replaceAll("\\", "/")}\"`, "probe"], { outputDir: task.outputDir, metadata: true, readonly: true });
		expect(result.output).toBe("value".repeat(8000)); expect(result.fullOutputPath).toBeUndefined();
	});

	it.each(["remote", "refs", "pathspec"])("rejects %s changes during an approval wait", async (change) => {
		const { cwd, config, call, task, decide, executed } = await setup();
		const list = join(cwd, "paths"); writeFileSync(list, "first\n");
		const pending = call({ args: change === "pathspec" ? ["checkout", `--pathspec-from-file=${list}`] : ["push", "--force", "origin"] });
		const rejected = expect(pending).rejects.toThrow("GIT_CONTEXT_CHANGED");
		await vi.waitFor(() => expect(task.gates).toHaveLength(1), { timeout: 10000 });
		if (change === "remote") config("remote.origin.pushurl", "https://changed.example/repo");
		else if (change === "pathspec") writeFileSync(list, "second\n");
		else writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/changed\n");
		await decide(); await rejected; expect(executed).toEqual([]);
	}, 15000);

	it.each(["deny", "abort", "dispose"] as const)("never executes after gate %s", async (action) => {
		const { call, task, gates, decide, executed } = await setup();
		const controller = new AbortController(); const pending = call({ args: ["push", "--force", "origin"] }, controller.signal); const rejected = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(task.gates).toHaveLength(1), { timeout: 10000 });
		if (action === "deny") await decide("deny"); else if (action === "abort") controller.abort(); else gates.dispose();
		await rejected; expect(executed).toEqual([]);
	}, 15000);

	it("blocks external execution if audit persistence fails", async () => {
		const { call, audit, executed, store, task } = await setup(); vi.spyOn(audit, "append").mockImplementation(() => { throw new Error("disk full"); });
		await expect(call({ args: ["push", "origin"] })).rejects.toThrow("disk full"); expect(executed).toEqual([]); expect(store.access(task.id)).toEqual([]);
	});

	it("uses actual argv for add and never reports repository scope as a changed file", async () => {
		const { cwd, host, store, task } = await setup(); writeFileSync(join(cwd, "file.txt"), "fixture\n");
		const tool = createGitTool(host); const context = {} as ExtensionToolContext;
		expect((await tool.execute("add", { args: ["add", "--", "file.txt"] }, undefined, undefined, context)).details.exitCode).toBe(0);
		const status = await tool.execute("status", { args: ["status", "--short"] }, undefined, undefined, context); expect(status.details.output).toContain("A  file.txt");
		expect(store.access(task.id).map((item) => item.kind)).toEqual(["fs_write", "fs_read"]); expect(task.changedFiles ?? []).toEqual([]);
	}, 15000);

	it("enforces readonly repo and common-dir boundaries and rejects terminal calls", async () => {
		const { cwd, task, call, executed, run } = await setup("readonly");
		await call({ args: ["status", "--short"] });
		await expect(call({ args: ["add", "--", "file"] })).rejects.toThrow("READONLY_TASK");
		const out = join(task.outputDir, "repo"); mkdirSync(out);
		execFileSync("git", ["init", out], { windowsHide: true, stdio: "ignore" });
		await call({ args: ["add", "--", "file"], cwd: out });
		const linked = join(task.outputDir, "linked"); mkdirSync(linked); writeFileSync(join(linked, ".git"), `gitdir: ${join(cwd, ".git").replaceAll("\\", "/")}\n`);
		await expect(call({ args: ["add", "--", "file"], cwd: linked })).rejects.toThrow("READONLY_TASK");
		await expect(call({ args: ["push", "origin"] })).rejects.toThrow("READONLY_TASK");
		expect(executed).toHaveLength(2); run.endedAt = Date.now();
		await expect(call({ args: ["status"] })).rejects.toThrow("TASK_ENDED");
	}, 15000);

	it("rejects aliases, remote groups and recursive pushes instead of hiding their targets", async () => {
		const { config, call, executed } = await setup(); config("alias.hidden", "push --force");
		await expect(call({ args: ["hidden"] })).rejects.toThrow("GIT_COMMAND_UNSUPPORTED");
		config("remotes.group", "origin second"); await expect(call({ args: ["push", "group"] })).rejects.toThrow("GIT_ARGUMENT_UNSUPPORTED");
		await expect(call({ args: ["push", "--recurse-submodules=on-demand"] })).rejects.toThrow("GIT_ARGUMENT_UNSUPPORTED"); expect(executed).toEqual([]);
	}, 15000);
});
