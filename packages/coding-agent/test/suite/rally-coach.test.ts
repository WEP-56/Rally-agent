import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@rally/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { CoachStore } from "../../../../src/main/coach-store.ts";
import { parseIdeas } from "../../../../src/main/supervisor/coach.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("coach production sessions with offline provider", () => {
  const owned: { harness: Harness; supervisor: Supervisor }[] = [];
  afterEach(async () => {
    for (const { harness, supervisor } of owned.splice(0)) { await supervisor.dispose(); harness.cleanup(); }
    vi.restoreAllMocks();
  });
  async function setup() {
    const harness = await createHarness({ provider: "coach-test", models: [{ id: "coach" }] });
    const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
    let now = new Date().setHours(3, 0, 0, 0) + 86400000;
    const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, coachNow: () => now, coachRandom: () => 1 });
    owned.push({ harness, supervisor });
    await supervisor.models.save([{ id: "coach-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux", models: [defaultModel("coach")] }]);
    const runtime = (await supervisor.models.whenReady())!;
    runtime.registerProvider("coach-test", { api: harness.faux.api, apiKey: "faux", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
    supervisor.models.setActive({ provider: "coach-test", model: "coach", thinkingLevel: "off" });
    await supervisor.start();
    harness.setResponses([fauxAssistantMessage("收到")]);
    await supervisor.main.send("我在做 Rally，想看看界面还能怎样改善");
    await vi.waitFor(() => expect(supervisor.main.state().messages.some(line => line.text === "收到") && !supervisor.main.isBusy()).toBe(true));
    vi.spyOn(Date, "now").mockImplementation(() => now);
    supervisor.coachSettings.update({ enabled: true, model: { provider: "coach-test", model: "coach", thinkingLevel: "off" }, ideasPerDay: 0 });
    return { supervisor, harness, paths, now, advance: (ms: number) => { now += ms; } };
  }
  it("persists validated settings", async () => {
    const { paths, supervisor } = await setup();
    expect(new CoachStore(paths.home).state().enabled).toBe(true);
    expect(() => supervisor.coachSettings.update({ quietStart: "24:00" })).toThrow();
    expect(() => supervisor.coachSettings.update({ quietEnd: "02:00" })).toThrow();
    expect(() => supervisor.coachSettings.update({ ideasPerDay: 3 })).toThrow();
  });
  it("waits while busy, disabled or missing a model", async () => {
    const { supervisor } = await setup();
    supervisor.coachSettings.update({ enabled: false }); await supervisor.coach.tick();
    supervisor.coachSettings.update({ enabled: true, model: null }); await supervisor.coach.tick();
    supervisor.coachSettings.update({ model: { provider: "coach-test", model: "coach", thinkingLevel: "off" } });
    vi.spyOn(supervisor.main, "isBusy").mockReturnValue(true); await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run")).toHaveLength(0);
  });
  it("writes memory in a disposable session and makes no task", async () => {
    const { supervisor, harness, paths } = await setup();
    const sessions = readdirSync(paths.sessionsMainDir);
    harness.setResponses([
      context => { expect(getCurrentTools(context.messages).map(tool => tool.name)).toEqual(expect.arrayContaining(["read", "write", "edit", "ls"])); return fauxAssistantMessage(fauxToolCall("write", { path: "USER.md", content: "- 做 Rally (fact, #1, 2026-11-23)\n" }), { stopReason: "toolUse" }); },
      fauxAssistantMessage("记下了项目"),
    ]);
    await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data, JSON.stringify(supervisor.events.ofKind("coach_run"))).toMatchObject({ result: "ok" });
    expect(readFileSync(join(paths.memoryDir, "USER.md"), "utf8")).toContain("Rally");
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data.result).toBe("ok");
    expect(supervisor.store.list()).toEqual([]);
    expect(readdirSync(paths.sessionsMainDir)).toEqual(sessions);
    expect(supervisor.main.state().messages.map(line => line.text)).not.toContain("记下了项目");
    await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run")).toHaveLength(1);
  });
  it("rejects outside and backup paths, restores an over-budget rewrite", async () => {
    const { supervisor, harness, paths } = await setup();
    writeFileSync(join(paths.memoryDir, "USER.md"), "before");
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "../outside.txt", content: "bad" }), { stopReason: "toolUse" }),
      context => { expect(getMessageText(context.messages.at(-1))).toContain("COACH_PATH_OUTSIDE_MEMORY"); return fauxAssistantMessage(fauxToolCall("write", { path: ".history/bad", content: "bad" }), { stopReason: "toolUse" }); },
      context => { expect(getMessageText(context.messages.at(-1))).toContain("COACH_PATH_OUTSIDE_MEMORY"); return fauxAssistantMessage(fauxToolCall("write", { path: "USER.md", content: "x".repeat(3001) }), { stopReason: "toolUse" }); },
      fauxAssistantMessage("done"),
    ]);
    await supervisor.coach.tick();
    expect(existsSync(join(paths.home, "outside.txt"))).toBe(false);
    expect(readFileSync(join(paths.memoryDir, "USER.md"), "utf8")).toBe("before");
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data.result).toBe("failed");
  });
  it("delivers one invisible idea and leaves no empty reply", async () => {
    const { supervisor, harness } = await setup();
    supervisor.coachSettings.update({ ideasPerDay: 1 });
    const before = supervisor.main.state().messages;
    harness.setResponses([fauxAssistantMessage("无变更"), context => {
      expect(getCurrentTools(context.messages)).toEqual([]);
      return fauxAssistantMessage(JSON.stringify({ ideas: [{ title: "界面", evidence: [before[0].id], why: "昨天提过", question: "看看布局？", prep: null }], recap: null }));
    }, fauxAssistantMessage("")]);
    await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data, JSON.stringify(supervisor.events.ofKind("coach_run"))).toMatchObject({ result: "ok" });
    await vi.waitFor(() => expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(1), { timeout: 5000 });
    await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
    expect(supervisor.main.state().messages).toEqual(before);
    expect(supervisor.events.ofKind("idea_raised")).toHaveLength(1);
    supervisor.userSeen(); supervisor.userSeen();
    expect(supervisor.events.ofKind("user_seen")).toHaveLength(1);
  });
  it("skips unchanged memory and suppresses ideas while the user is absent", async () => {
    const { supervisor, harness, advance } = await setup();
    supervisor.coachSettings.update({ ideasPerDay: 1 });
    harness.setResponses([fauxAssistantMessage("无变更"), fauxAssistantMessage(JSON.stringify({ ideas: [], recap: "昨天聊了项目" })), fauxAssistantMessage("")]);
    await supervisor.coach.tick();
    await vi.waitFor(() => expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(1), { timeout: 5000 });
    await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
    advance(86400000);
    await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data).toMatchObject({ kind: "memory", result: "skipped" });
    expect(supervisor.events.ofKind("coach_run").filter(event => event.data.kind === "idea")).toHaveLength(1);
    supervisor.userSeen();
    advance(86400000);
    harness.setResponses([fauxAssistantMessage("bad json")]);
    await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data).toMatchObject({ kind: "idea", result: "failed" });
    await supervisor.coach.tick();
    expect(supervisor.events.ofKind("coach_run").filter(event => event.data.kind === "idea")).toHaveLength(2);
  });
  it("rolls back an interrupted coach before accepting new user work", async () => {
    const { supervisor, harness, paths } = await setup();
    writeFileSync(join(paths.memoryDir, "USER.md"), "before");
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "USER.md", content: "temporary" }), { stopReason: "toolUse" }),
      async () => { started.resolve(); await release.promise; return fauxAssistantMessage("整理好了"); },
      fauxAssistantMessage("新消息收到"),
    ]);
    const run = supervisor.coach.tick();
    await started.promise;
    const send = supervisor.main.send("先处理我的新消息");
    release.resolve();
    await Promise.all([run, send]);
    await vi.waitFor(() => expect(supervisor.main.state().messages.some(line => line.text === "新消息收到")).toBe(true));
    expect(readFileSync(join(paths.memoryDir, "USER.md"), "utf8")).toBe("before");
    expect(supervisor.events.ofKind("coach_run").at(-1)?.data.result).toBe("failed");
  });
  it("rejects malformed JSON and invented message references", () => {
    expect(() => parseIdeas("not json", new Set(), new Set())).toThrow();
    const idea = { title: "x", evidence: ["#99"], why: "x", question: "x?", prep: null };
    expect(parseIdeas(JSON.stringify({ ideas: [idea], recap: null }), new Set(["#1"]), new Set()).idea).toBeUndefined();
    expect(parseIdeas(JSON.stringify({ ideas: [idea, { ...idea, evidence: ["#1"] }] }), new Set(["#1"]), new Set()).idea?.evidence).toEqual(["#1"]);
  });
});
