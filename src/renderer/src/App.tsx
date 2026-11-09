import { Globe, IdCard, Info, Moon, Palette, PanelRight, Plug, Settings as SettingsIcon, SquarePen, SquareTerminal, Sun, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "./chat";
import { titleFor } from "./components/BrowserView";
import { ChatPanel } from "./components/ChatPanel";
import { type Cmd, CommandPalette } from "./components/CommandPalette";
import { Onboarding } from "./components/Onboarding";
import { RightPanel } from "./components/RightPanel";
import { Settings } from "./components/Settings";
import { type Menu, TitleBar } from "./components/TitleBar";
import { type AppCtx, type Config, Ctx, loadConfig, loadOnboarded, saveConfig, saveOnboarded, type Tab, type TabKind, uid } from "./store";
import { useModels } from "./models";
import { useTasks } from "./tasks";
import { cn } from "./utils/cn";

const winApi = window.rally.window;

const KIND_TITLE: Record<Exclude<TabKind, "task">, string> = { workstation: "Rally 的工位", browser: "新标签页", terminal: "终端" };

export default function App() {
  const [config, setConfigState] = useState<Config>(loadConfig);
  const [onboarded, setOnboarded] = useState(loadOnboarded);
  const [view, setView] = useState<"main" | "settings">("main");
  const [section, setSection] = useState("general");
  const [maximized, setMaximized] = useState(false);
  const [palette, setPalette] = useState(false);

  const [rightOpen, setRightOpen] = useState(true);
  const [ratio, setRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const [tabs, setTabs] = useState<Tab[]>([{ id: "w0", kind: "workstation", title: "Rally 的工位" }]);
  const [active, setActive] = useState<string | null>("w0");
  const { tasks, board, setAutoApprove } = useTasks();
  const models = useModels();
  const [inject, setInject] = useState({ text: "", n: 0 });

  /* ---------------- config / theme ---------------- */
  const setConfig = useCallback((patch: Partial<Config>) => {
    setConfigState((c) => {
      const n = { ...c, ...patch };
      saveConfig(n);
      return n;
    });
  }, []);

  const [sysDark, setSysDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq?.addEventListener("change", h);
    return () => mq?.removeEventListener("change", h);
  }, []);
  const dark = config.theme === "dark" || (config.theme === "system" && sysDark);
  useEffect(() => {
    const r = document.documentElement;
    r.classList.toggle("dark", dark);
    r.style.setProperty("--c-accent", config.accent);
    r.style.fontSize = { sm: "14px", md: "15px", lg: "16px" }[config.fontSize];
  }, [dark, config.accent, config.fontSize]);

  /* ---------------- tabs ---------------- */
  const addTab = useCallback((t: Tab) => {
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
  }, []);

  const openTab = useCallback(
    (kind: Exclude<TabKind, "task">, opts?: { url?: string }) => {
      setView("main");
      setRightOpen(true);
      if (kind === "workstation") {
        const ex = tabs.find((t) => t.kind === "workstation");
        if (ex) return setActive(ex.id);
      }
      addTab({ id: uid(), kind, title: kind === "browser" && opts?.url ? titleFor(opts.url) : KIND_TITLE[kind], url: opts?.url });
    },
    [tabs, addTab],
  );

  const openTask = useCallback(
    (taskId: string) => {
      setView("main");
      setRightOpen(true);
      const ex = tabs.find((t) => t.taskId === taskId);
      if (ex) return setActive(ex.id);
      const task = tasks.find((t) => t.id === taskId);
      addTab({ id: uid(), kind: "task", title: task?.title || taskId, taskId });
    },
    [tabs, tasks, addTab],
  );

  const closeTab = (id: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const n = ts.filter((t) => t.id !== id);
      if (active === id) setActive(n[Math.min(i, n.length - 1)]?.id ?? null);
      return n;
    });
  };

  const openSettings = useCallback((s?: string) => {
    if (s) setSection(s);
    setView("settings");
  }, []);

  const rerunOnboarding = useCallback(() => {
    saveOnboarded(false);
    setOnboarded(false);
    setView("main");
  }, []);

  /* ---------------- chat ---------------- */
  const chat = useChat();
  const stop = () => void chat.abort();
  const newChat = () => void chat.reset();

  /* ---------------- resize ---------------- */
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const r = container.current!.getBoundingClientRect();
      const w = r.right - ev.clientX;
      const min = 340;
      const clamped = Math.max(min, Math.min(r.width - 360, w));
      setRatio(clamped / r.width);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ---------------- window ---------------- */
  useEffect(() => {
    void winApi.isMaximized().then(setMaximized);
    return winApi.onMaximizedChange(setMaximized);
  }, []);
  const toggleMax = () => winApi.toggleMaximize();
  const minimize = () => winApi.minimize();
  const close = () => winApi.close();

  /* ---------------- shortcuts ---------------- */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!onboarded) return;
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRightOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      } else if (mod && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        openTab((["workstation", "browser", "terminal"] as const)[+e.key - 1]);
      } else if (e.key === "Escape" && view === "settings" && !palette) {
        setView("main");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  /* ---------------- menus ---------------- */
  const exec = (c: string) => () => document.execCommand(c);
  const menus: Menu[] = [
    {
      key: "window",
      label: "窗口",
      mnemonic: "W",
      groups: [
        [
          { label: "整理上下文", shortcut: "Ctrl+N", action: newChat },
          { label: "显示右侧栏", shortcut: "Ctrl+B", checked: rightOpen, action: () => setRightOpen((v) => !v) },
          { label: "命令面板", shortcut: "Ctrl+K", action: () => setPalette(true) },
        ],
        [
          { label: "最小化", action: minimize },
          { label: maximized ? "还原窗口" : "最大化", action: toggleMax },
        ],
        [{ label: "重新运行首次引导", action: rerunOnboarding }],
      ],
    },
    {
      key: "edit",
      label: "编辑",
      mnemonic: "E",
      groups: [
        [
          { label: "撤销", shortcut: "Ctrl+Z", action: exec("undo") },
          { label: "重做", shortcut: "Ctrl+Y", action: exec("redo") },
        ],
        [
          { label: "剪切", shortcut: "Ctrl+X", action: exec("cut") },
          { label: "复制", shortcut: "Ctrl+C", action: exec("copy") },
          { label: "粘贴", shortcut: "Ctrl+V", action: exec("paste") },
        ],
        [{ label: "全选", shortcut: "Ctrl+A", action: exec("selectAll") }],
      ],
    },
    {
      key: "view",
      label: "查看",
      mnemonic: "V",
      groups: [
        [
          { label: "Rally 的工位", shortcut: "Ctrl+1", action: () => openTab("workstation") },
          { label: "浏览器", shortcut: "Ctrl+2", action: () => openTab("browser") },
          { label: "终端", shortcut: "Ctrl+3", action: () => openTab("terminal") },
        ],
        [
          { label: "浅色", checked: config.theme === "light", action: () => setConfig({ theme: "light" }) },
          { label: "深色", checked: config.theme === "dark", action: () => setConfig({ theme: "dark" }) },
          { label: "跟随系统", checked: config.theme === "system", action: () => setConfig({ theme: "system" }) },
        ],
        [
          { label: "放大", shortcut: "Ctrl+=", disabled: config.fontSize === "lg", action: () => setConfig({ fontSize: config.fontSize === "sm" ? "md" : "lg" }) },
          { label: "缩小", shortcut: "Ctrl+-", disabled: config.fontSize === "sm", action: () => setConfig({ fontSize: config.fontSize === "lg" ? "md" : "sm" }) },
          { label: "重置缩放", shortcut: "Ctrl+0", action: () => setConfig({ fontSize: "md" }) },
        ],
      ],
    },
    { key: "settings", label: "设置", mnemonic: "S", action: () => openSettings() },
  ];

  const commands: Cmd[] = useMemo(
    () => [
      { id: "new", label: "整理上下文", group: "操作", icon: <SquarePen size={14} />, hint: "Ctrl+N", run: newChat },
      { id: "toggle", label: "切换右侧栏", group: "操作", icon: <PanelRight size={14} />, hint: "Ctrl+B", run: () => setRightOpen((v) => !v) },
      { id: "ws", label: "打开 Rally 的工位", group: "操作", icon: <IdCard size={14} />, hint: "Ctrl+1", run: () => openTab("workstation") },
      { id: "br", label: "打开浏览器", group: "操作", icon: <Globe size={14} />, hint: "Ctrl+2", run: () => openTab("browser") },
      { id: "tm", label: "打开终端", group: "操作", icon: <SquareTerminal size={14} />, hint: "Ctrl+3", run: () => openTab("terminal") },
      { id: "theme", label: dark ? "切换到浅色主题" : "切换到深色主题", group: "操作", icon: dark ? <Sun size={14} /> : <Moon size={14} />, run: () => setConfig({ theme: dark ? "light" : "dark" }) },
      { id: "s-gen", label: "设置：身份", group: "设置", icon: <SettingsIcon size={14} />, hint: "Ctrl+,", run: () => openSettings("general") },
      { id: "s-mcp", label: "设置：MCP 服务器", group: "设置", icon: <Plug size={14} />, run: () => openSettings("mcp") },
      { id: "s-sk", label: "设置：Skills", group: "设置", icon: <Wand2 size={14} />, run: () => openSettings("skills") },
      { id: "s-ap", label: "设置：外观", group: "设置", icon: <Palette size={14} />, run: () => openSettings("appearance") },
      { id: "s-ab", label: "设置：关于与更新", group: "设置", icon: <Info size={14} />, run: () => openSettings("about") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark, tabs],
  );

  const ctx: AppCtx = { config, setConfig, openTab, openTask, openSettings, rerunOnboarding };

  return (
    <Ctx.Provider value={ctx}>
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-app">
          <TitleBar
            menus={menus}
            onSearch={() => setPalette(true)}
            maximized={maximized}
            onMin={minimize}
            onMax={toggleMax}
            onClose={close}
          />

          {view === "settings" ? (
            <div className="min-h-0 flex-1">
              <Settings section={section} setSection={setSection} onBack={() => setView("main")} />
            </div>
          ) : (
            <div ref={container} className="flex min-h-0 flex-1 px-1.5 pb-1.5">
              <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-panel shadow-card">
                <ChatPanel
                  messages={chat.messages}
                  tasks={tasks}
                  busy={chat.busy}
                  onSend={chat.send}
                  onStop={stop}
                  onNewChat={newChat}
                  rightOpen={rightOpen}
                  onToggleRight={() => setRightOpen((v) => !v)}
                  inject={inject}
                  models={models.state?.available ?? []}
                  model={chat.model}
                  thinkingLevel={chat.thinkingLevel}
                  onSelectModel={chat.selectModel}
                  autoApprove={board.autoApprove}
                  onAutoApprove={setAutoApprove}
                />
              </div>

              <div
                className={cn("relative flex shrink-0", !dragging && "transition-[width,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]", !rightOpen && "pointer-events-none opacity-0")}
                style={{ width: rightOpen ? `${ratio * 100}%` : 0 }}
              >
                {/* drag handle (the gap itself) */}
                <div onPointerDown={startDrag} onDoubleClick={() => setRatio(0.5)} className="group relative z-10 flex w-1.5 shrink-0 cursor-col-resize items-center justify-center" title="拖拽调整宽度，双击恢复等分">
                  <div className={cn("h-10 w-[3px] rounded-full transition-all", dragging ? "h-16 bg-accent" : "bg-transparent group-hover:bg-faint/60")} />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-panel shadow-card">
                  <div className="h-full" style={{ minWidth: 330 }}>
                    <RightPanel
                      tabs={tabs}
                      active={active}
                      setActive={setActive}
                      closeTab={closeTab}
                      newTab={(k) => openTab(k)}
                      tasks={tasks}
                      renameTab={(id, title) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title } : t)))}
                      onMention={(t) => setInject((s) => ({ text: `@${t.id.toUpperCase()}「${t.title}」`, n: s.n + 1 }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {dragging && <div className="fixed inset-0 z-[200] cursor-col-resize" />}

          <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} tasks={tasks} onTask={openTask} />

          {!onboarded && (
            <Onboarding
              maximized={maximized}
              onMin={minimize}
              onMax={toggleMax}
              onClose={close}
              onDone={() => {
                saveOnboarded(true);
                setOnboarded(true);
              }}
            />
          )}
      </div>
    </Ctx.Provider>
  );
}
