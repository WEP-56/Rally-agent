import { useEffect, useRef, useState } from "react";
import type { Task } from "../data";
import { useApp } from "../store";
import { STATUS_META } from "./status";

type Line = { t: "in" | "out" | "err" | "ok"; s: string; cwd?: string };

const FS: Record<string, string[]> = {
  "C:\\Users\\you\\rally": ["repo", "notes", "reports", "web", "README.md", "rally.config.json"],
  "C:\\Users\\you\\rally\\repo": ["docs", "src", "tests", "README.md", "package.json"],
  "C:\\Users\\you\\rally\\notes": ["index.md", "brief.md", "dsh-superagent 架构分析.md"],
  "C:\\Users\\you\\rally\\reports": ["2026-W44.md"],
  "C:\\Users\\you\\rally\\web": ["landing"],
};

export function TerminalView({ tasks }: { tasks: Task[] }) {
  const { config } = useApp();
  const [cwd, setCwd] = useState("C:\\Users\\you\\rally");
  const [lines, setLines] = useState<Line[]>([
    { t: "out", s: "Rally Terminal  ·  PowerShell 7.5.0" },
    { t: "out", s: "输入 help 查看可用命令。\n" },
  ]);
  const [input, setInput] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines]);

  const run = (raw: string) => {
    const cmd = raw.trim();
    const out: Line[] = [{ t: "in", s: raw, cwd }];
    const [c, ...args] = cmd.split(/\s+/);
    const arg = args.join(" ");
    const push = (s: string, t: Line["t"] = "out") => out.push({ t, s });
    switch ((c || "").toLowerCase()) {
      case "":
        break;
      case "help":
        push("可用命令：\n  ls / dir        列出文件\n  cd <dir>        切换目录\n  pwd             当前目录\n  cat <file>      查看文件\n  echo <text>     输出文本\n  rally status    查看 Rally 状态\n  rally tasks     列出工位任务\n  git status      仓库状态\n  node -v         Node 版本\n  npm run dev     启动开发服务\n  date / whoami / clear");
        break;
      case "clear":
      case "cls":
        setLines([]);
        return;
      case "ls":
      case "dir":
        push((FS[cwd] || []).map((f) => (f.includes(".") ? f : f + "\\")).join("    ") || "(空目录)");
        break;
      case "pwd":
        push(cwd);
        break;
      case "cd": {
        if (!arg || arg === "~") setCwd("C:\\Users\\you\\rally");
        else if (arg === "..") setCwd(cwd.split("\\").slice(0, -1).join("\\") || cwd);
        else if (FS[cwd + "\\" + arg]) setCwd(cwd + "\\" + arg);
        else push(`cd: 找不到路径 '${arg}'`, "err");
        break;
      }
      case "cat":
      case "type":
        if (arg === "README.md") push("# Rally workspace\n\n由 Rally 管理的工作区。工位任务的产物会写入 notes/ 与 reports/。");
        else if (arg === "rally.config.json") push(JSON.stringify({ name: config.name, memory: config.memoryPath, rallyModel: config.rallyModel || "gpt-5", taskModel: config.taskModel || "gpt-5-mini" }, null, 2));
        else push(`cat: ${arg || "<file>"}: 没有那个文件`, "err");
        break;
      case "echo":
        push(arg);
        break;
      case "date":
        push(new Date().toLocaleString("zh-CN"));
        break;
      case "whoami":
        push("desktop\\you");
        break;
      case "node":
        push("v22.19.0");
        break;
      case "git":
        if (args[0] === "status") push("On branch main\nChanges not staged for commit:\n  modified:   notes/index.md\n\nUntracked files:\n  notes/dsh-superagent 架构分析.md");
        else push("usage: git status", "err");
        break;
      case "npm":
        if (arg === "run dev") push("\n  VITE v7.3.2  ready in 386 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  press h + enter to show help", "ok");
        else push("npm: 仅支持 npm run dev（预览环境）", "err");
        break;
      case "rally":
        if (args[0] === "tasks")
          push(tasks.map((t) => `${t.id.toUpperCase().padEnd(8)} ${STATUS_META[t.status].label.padEnd(4, "　")}  ${t.title}`).join("\n"));
        else push(`${config.name} · 在线\n记忆：${config.memoryPath}\n任务：${tasks.length} 个（进行中 ${tasks.filter((t) => t.status === "running").length}）`, "ok");
        break;
      default:
        push(`${c}: 无法将“${c}”识别为 cmdlet、函数、脚本文件或可运行程序的名称。`, "err");
    }
    setLines((l) => [...l, ...out]);
  };

  return (
    <div className="flex h-full flex-col bg-term" onClick={() => inp.current?.focus()}>
      <div ref={box} className="selectable min-h-0 flex-1 overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-[1.7]">
        {lines.map((l, i) =>
          l.t === "in" ? (
            <div key={i} className="whitespace-pre-wrap">
              <span className="text-accent">PS</span> <span className="text-muted">{l.cwd}&gt;</span> <span className="text-fg">{l.s}</span>
            </div>
          ) : (
            <div key={i} className={l.t === "err" ? "whitespace-pre-wrap text-red-500" : l.t === "ok" ? "whitespace-pre-wrap text-accent" : "whitespace-pre-wrap text-fg/75"}>
              {l.s}
            </div>
          ),
        )}
        <form
          className="flex"
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
            if (input.trim()) setHist((h) => [...h, input]);
            setHi(-1);
            setInput("");
          }}
        >
          <span className="shrink-0 whitespace-pre">
            <span className="text-accent">PS</span> <span className="text-muted">{cwd}&gt;</span>{" "}
          </span>
          <input
            ref={inp}
            autoFocus
            value={input}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && hist.length) {
                e.preventDefault();
                const n = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1);
                setHi(n);
                setInput(hist[n]);
              } else if (e.key === "ArrowDown" && hi >= 0) {
                e.preventDefault();
                const n = hi + 1;
                if (n >= hist.length) {
                  setHi(-1);
                  setInput("");
                } else {
                  setHi(n);
                  setInput(hist[n]);
                }
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-fg caret-accent"
          />
        </form>
      </div>
    </div>
  );
}
