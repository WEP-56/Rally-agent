import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Activity, ChatItem, Entry, GateReq, SimTask, Tab, Tier, ToolEntry } from "./types";
import { matchScript, type Script, type ToolSpec } from "./scripts";

/* ─────────────────────────── 状态 ─────────────────────────── */

interface SimState {
  chat: ChatItem[];
  tasks: SimTask[];
  tiers: Record<string, Tier>;
  activity: Activity;
  running: boolean;
  flash: "completed" | null;
  mentions: string[];
}

type Action =
  | { type: "chat/add"; item: ChatItem }
  | { type: "chat/update"; id: string; update: (item: ChatItem) => ChatItem }
  | { type: "chat/remove"; id: string }
  | { type: "chat/reset" }
  | { type: "task/add"; task: SimTask }
  | { type: "task/update"; id: string; update: (task: SimTask) => SimTask }
  | { type: "tier/set"; tool: string; tier: Tier }
  | { type: "activity"; value: Activity }
  | { type: "running"; value: boolean }
  | { type: "flash"; value: "completed" | null }
  | { type: "mention/add"; id: string }
  | { type: "mention/clear" };

function reducer(state: SimState, action: Action): SimState {
  switch (action.type) {
    case "chat/add":
      return { ...state, chat: [...state.chat, action.item] };
    case "chat/update":
      return { ...state, chat: state.chat.map((item) => (item.id === action.id ? action.update(item) : item)) };
    case "chat/remove":
      return { ...state, chat: state.chat.filter((item) => item.id !== action.id) };
    case "chat/reset":
      return { ...state, chat: [] };
    case "task/add":
      return { ...state, tasks: [action.task, ...state.tasks] };
    case "task/update":
      return { ...state, tasks: state.tasks.map((task) => (task.id === action.id ? action.update(task) : task)) };
    case "tier/set":
      return { ...state, tiers: { ...state.tiers, [action.tool]: action.tier } };
    case "activity":
      return { ...state, activity: action.value };
    case "running":
      return { ...state, running: action.value };
    case "flash":
      return { ...state, flash: action.value };
    case "mention/add":
      return state.mentions.includes(action.id) ? state : { ...state, mentions: [...state.mentions, action.id] };
    case "mention/clear":
      return { ...state, mentions: [] };
  }
}

const NOW = Date.now();
const SEED_TASKS: SimTask[] = [
  {
    id: "d2q7",
    title: "整理下载文件夹",
    summary: "47 个文件已归类到 5 个目录",
    status: "done",
    createdAt: NOW - 5 * 3600e3,
    duration: "18s",
    cwd: "~/Downloads",
    items: [
      { kind: "tool", id: "s1", name: "ls", target: "~/Downloads", output: "共 47 个文件：21 张图片、12 份文档、9 个安装包、5 个压缩包", status: "ok", duration: "0.9s" },
      { kind: "text", id: "s2", text: "全部归好类了，重名的文件已自动加序号。" },
    ],
  },
  {
    id: "k3m9",
    title: "晨报速递",
    summary: "3 条 AI 重点已发到邮箱",
    status: "done",
    createdAt: NOW - 27 * 3600e3,
    duration: "42s",
    cwd: "~/Rally/晨报",
    items: [{ kind: "text", id: "s3", text: "今天的晨报已经发出，共 3 条重点。" }],
  },
  {
    id: "p8w2",
    title: "盯住显卡价格",
    summary: "每 2 小时 · 9:00–21:00 · 低于 ¥4599 通知",
    status: "scheduled",
    createdAt: NOW - 2 * 3600e3,
    duration: "定时",
    cwd: "~/Rally/盯价",
    items: [],
  },
];

const initialState: SimState = {
  chat: [],
  tasks: SEED_TASKS,
  tiers: { qqmail_send: "irreversible" },
  activity: "idle",
  running: false,
  flash: null,
  mentions: [],
};

/* ─────────────────────────── 引擎 ─────────────────────────── */

export interface Panes {
  tabs: Tab[];
  active: string;
  rightOpen: boolean;
  ratio: number;
}

export interface SimApi extends Panes {
  state: SimState;
  send: (text: string) => void;
  stop: () => void;
  newChat: () => void;
  decideGate: (id: string, decision: "allow" | "deny") => void;
  answerQuestion: (id: string, answer: string) => void;
  setTier: (tool: string, tier: Tier) => void;
  mention: (taskId: string) => void;
  clearMentions: () => void;
  openTask: (taskId: string) => void;
  openKind: (kind: "workstation" | "connections") => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setRightOpen: (open: boolean) => void;
  setRatio: (ratio: number) => void;
}

const SimContext = createContext<SimApi | null>(null);

export function useSim(): SimApi {
  const api = useContext(SimContext);
  if (!api) throw new Error("useSim 必须在 SimProvider 内使用");
  return api;
}

const WORKSTATION_TAB: Tab = { id: "workstation", kind: "workstation" };
const DEFAULT_RATIO = 0.46;
const CANCELLED = new Error("cancelled");
const QUERY_TOOLS = new Set(["github", "browser", "grep", "ls"]);

interface RunCtx {
  cancelled: boolean;
}

function uid() {
  return Math.random().toString(36).slice(2, 6);
}

function clockSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SimProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runRef = useRef<RunCtx | null>(null);
  const waiters = useRef(new Map<string, (value: string) => void>());
  const [panes, setPanes] = useState<Panes>({ tabs: [WORKSTATION_TAB], active: WORKSTATION_TAB.id, rightOpen: true, ratio: DEFAULT_RATIO });

  useEffect(() => {
    if (!state.flash) return;
    const timer = window.setTimeout(() => dispatch({ type: "flash", value: null }), 2400);
    return () => window.clearTimeout(timer);
  }, [state.flash]);

  const waitFor = (id: string) =>
    new Promise<string>((resolve) => {
      waiters.current.set(id, resolve);
    });

  const settle = (id: string, value: string) => {
    waiters.current.get(id)?.(value);
    waiters.current.delete(id);
  };

  const updateTask = (id: string, update: (task: SimTask) => SimTask) => dispatch({ type: "task/update", id, update });

  const patchTool = (taskId: string, itemId: string, patch: Partial<ToolEntry>) =>
    updateTask(taskId, (task) => ({
      ...task,
      items: task.items.map((item) => (item.kind === "tool" && item.id === itemId ? { ...item, ...patch } : item)),
    }));

  const appendTaskEntry = (taskId: string, entry: Entry) =>
    updateTask(taskId, (task) => ({ ...task, items: [...task.items, entry] }));

  async function execute(script: Script, run: RunCtx) {
    let taskId = "";
    let answer = "";
    let denied = false;

    const pause = async (ms: number) => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
      if (run.cancelled) throw CANCELLED;
    };
    const setActivity = (value: Activity) => dispatch({ type: "activity", value });

    /** 主 Agent 的工具调用：先出现执行中，再回填结果 */
    const runMainTool = async (spec: ToolSpec) => {
      const id = uid();
      const started = Date.now();
      dispatch({ type: "chat/add", item: { kind: "tool", id, name: spec.name, target: spec.target, output: spec.output, status: "running" } });
      setActivity(QUERY_TOOLS.has(spec.name) ? "querying" : "tooling");
      await pause(spec.ms ?? 900);
      dispatch({ type: "chat/update", id, update: (item) => (item.kind === "tool" ? { ...item, status: "ok", duration: clockSeconds(Date.now() - started) } : item) });
    };

    /** Worker 任务内的工具调用：写入任务转录 */
    const runWorkerTool = async (spec: ToolSpec, note?: string) => {
      const id = uid();
      const started = Date.now();
      appendTaskEntry(taskId, { kind: "tool", id, name: spec.name, target: spec.target, output: spec.output, status: "running" });
      setActivity("tooling");
      await pause(spec.ms ?? 900);
      patchTool(taskId, id, { status: "ok", duration: clockSeconds(Date.now() - started), note });
    };

    for (const step of script.steps) {
      if (step.op === "say") {
        const text = step.text.replace("{answer}", answer);
        const typingId = uid();
        dispatch({ type: "chat/add", item: { kind: "typing", id: typingId } });
        setActivity("thinking");
        await pause(Math.min(1300, 450 + text.length * 22));
        dispatch({ type: "chat/remove", id: typingId });
        dispatch({ type: "chat/add", item: { kind: "text", id: uid(), text } });
        setActivity("replying");
        await pause(500);
      } else if (step.op === "tool") {
        await runMainTool(step);
      } else if (step.op === "ask") {
        const id = uid();
        dispatch({ type: "chat/add", item: { kind: "question", id, question: { id, question: step.question, options: step.options } } });
        setActivity("idle");
        answer = await waitFor(id);
        if (answer === "stop") throw CANCELLED;
        if (run.cancelled) throw CANCELLED;
        dispatch({ type: "chat/update", id, update: (item) => (item.kind === "question" ? { ...item, question: { ...item.question, answer } } : item) });
        await pause(300);
      } else if (step.op === "dispatch") {
        taskId = uid();
        dispatch({
          type: "task/add",
          task: { id: taskId, title: step.title, summary: step.summary, status: "running", createdAt: Date.now(), duration: "进行中", cwd: step.cwd, items: [] },
        });
        dispatch({ type: "chat/add", item: { kind: "task", id: uid(), taskId } });
        setActivity("orchestrating");
        await pause(700);
      } else if (step.op === "work") {
        await runWorkerTool(step);
      } else if (step.op === "workSay") {
        appendTaskEntry(taskId, { kind: "text", id: uid(), text: step.text });
        await pause(500);
      } else if (step.op === "gate") {
        const tier = stateRef.current.tiers[step.run.name] ?? "irreversible";
        if (tier === "external") {
          // 用户把这个工具调成“有对外代价”：不再拦截，但留审计
          await runWorkerTool(step.run, "有对外代价 · 已留审计");
        } else {
          const gate: GateReq = {
            id: uid(),
            taskId,
            tool: `${step.run.name} · ${step.run.target}`,
            action: step.action,
            cwd: step.cwd,
            scope: step.scope,
            alternative: step.alternative,
            mailBody: step.mailBody,
            expiresAt: Date.now() + 120_000,
          };
          dispatch({ type: "chat/add", item: { kind: "gate", id: gate.id, gate } });
          updateTask(taskId, (task) => ({ ...task, status: "needs_gate" }));
          setActivity("idle");
          const decision = await waitFor(gate.id);
          if (decision === "stop" || run.cancelled) throw CANCELLED;
          updateTask(taskId, (task) => ({ ...task, status: "running" }));
          if (decision === "allow") {
            await runWorkerTool(step.run);
          } else {
            denied = true;
            appendTaskEntry(taskId, { kind: "text", id: uid(), text: step.denied });
            await pause(400);
          }
        }
      } else if (step.op === "finish") {
        updateTask(taskId, (task) => ({ ...task, status: step.status, duration: step.duration }));
        const text = denied && step.deniedText ? step.deniedText : step.text;
        dispatch({ type: "chat/add", item: { kind: "text", id: uid(), text, final: true } });
        setActivity("replying");
        if (step.status === "done" && !denied) dispatch({ type: "flash", value: "completed" });
        await pause(600);
      }
    }
  }

  function runScript(script: Script) {
    const run: RunCtx = { cancelled: false };
    runRef.current = run;
    dispatch({ type: "running", value: true });
    execute(script, run)
      .catch((error: unknown) => {
        if (error !== CANCELLED) throw error;
      })
      .finally(() => {
        if (runRef.current !== run) return;
        runRef.current = null;
        dispatch({ type: "running", value: false });
        dispatch({ type: "activity", value: "idle" });
      });
  }

  const api: SimApi = {
    ...panes,
    state,
    send(text) {
      const trimmed = text.trim();
      if (!trimmed || runRef.current) return;
      dispatch({ type: "chat/add", item: { kind: "user", id: uid(), text: trimmed } });
      runScript(matchScript(trimmed));
    },
    stop() {
      const run = runRef.current;
      if (!run) return;
      run.cancelled = true;
      runRef.current = null;
      waiters.current.forEach((resolve) => resolve("stop"));
      waiters.current.clear();
      // 还在等待的门禁与问题直接收起，否则卡片会一直挂着、按钮却没有任何反应
      stateRef.current.chat.forEach((item) => {
        if (item.kind === "gate" && !item.gate.decision) {
          dispatch({ type: "chat/update", id: item.id, update: (current) => (current.kind === "gate" ? { ...current, gate: { ...current.gate, decision: "deny" } } : current) });
        }
        if (item.kind === "question" && !item.question.answer) {
          dispatch({ type: "chat/update", id: item.id, update: (current) => (current.kind === "question" ? { ...current, question: { ...current.question, closed: true } } : current) });
        }
      });
      stateRef.current.tasks
        .filter((task) => task.status === "running" || task.status === "needs_gate")
        .forEach((task) => updateTask(task.id, (current) => ({ ...current, status: "interrupted" })));
      dispatch({ type: "chat/add", item: { kind: "system", id: uid(), text: "已停止这次任务，Rally 不会继续执行后续步骤。" } });
      dispatch({ type: "running", value: false });
      dispatch({ type: "activity", value: "idle" });
    },
    newChat() {
      if (runRef.current) api.stop();
      dispatch({ type: "chat/reset" });
    },
    decideGate(id, decision) {
      if (!waiters.current.has(id)) return;
      dispatch({
        type: "chat/update",
        id,
        update: (item) => (item.kind === "gate" ? { ...item, gate: { ...item.gate, decision } } : item),
      });
      settle(id, decision);
    },
    answerQuestion(id, value) {
      if (!waiters.current.has(id)) return;
      settle(id, value);
    },
    setTier(tool, tier) {
      dispatch({ type: "tier/set", tool, tier });
    },
    mention(taskId) {
      dispatch({ type: "mention/add", id: taskId });
    },
    clearMentions() {
      dispatch({ type: "mention/clear" });
    },
    openTask(taskId) {
      setPanes((current) => {
        const exists = current.tabs.some((tab) => tab.taskId === taskId);
        const tabs = exists ? current.tabs : [...current.tabs, { id: `task-${taskId}`, kind: "task" as const, taskId }];
        return { ...current, tabs, active: `task-${taskId}`, rightOpen: true };
      });
    },
    openKind(kind) {
      setPanes((current) => {
        const exists = current.tabs.some((tab) => tab.kind === kind);
        const tabs = exists ? current.tabs : [...current.tabs, { id: kind, kind }];
        return { ...current, tabs, active: kind, rightOpen: true };
      });
    },
    closeTab(id) {
      setPanes((current) => {
        const tabs = current.tabs.filter((tab) => tab.id !== id);
        return { ...current, tabs, active: current.active === id ? WORKSTATION_TAB.id : current.active };
      });
    },
    setActive(id) {
      setPanes((current) => ({ ...current, active: id }));
    },
    setRightOpen(open) {
      setPanes((current) => ({ ...current, rightOpen: open }));
    },
    setRatio(ratio) {
      setPanes((current) => ({ ...current, ratio }));
    },
  };

  return <SimContext.Provider value={api}>{children}</SimContext.Provider>;
}
