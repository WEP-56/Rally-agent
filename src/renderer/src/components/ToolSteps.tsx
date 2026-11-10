import { useState } from "react";
import { Brain, ChevronRight, FilePen, FilePlus2, FileX2, Glasses, Globe, Search, Sparkles, SquareTerminal, Copy, Check, ListTodo, Wrench } from "lucide-react";
import type { StepKind, ToolStep } from "../data";
import { cn } from "../utils/cn";

const ICON: Record<StepKind, typeof Glasses> = {
  task: ListTodo,
  tool: Wrench,
  memory: Brain,
  cmd: SquareTerminal,
  read: Glasses,
  write: FilePlus2,
  edit: FilePen,
  delete: FileX2,
  search: Search,
  web: Globe,
  think: Sparkles,
};

const VERB: Record<StepKind, string> = {
  task: "任务工具",
  tool: "已调用工具",
  memory: "记忆工具",
  cmd: "命令已执行",
  read: "已读取",
  write: "已创建",
  edit: "已编辑",
  delete: "删除工具",
  search: "已搜索",
  web: "已调用工具",
  think: "已思考",
};

export function summarize(steps: ToolStep[]) {
  const c = (k: StepKind) => steps.filter((s) => s.kind === k && (!s.status || s.status === "ok")).length;
  const parts: string[] = [];
  if (c("write")) parts.push(`已创建 ${c("write")} 个文件`);
  if (c("edit")) parts.push(`编辑 ${c("edit")} 个文件`);
  if (c("delete")) parts.push(`调用 ${c("delete")} 次删除工具`);
  if (c("read")) parts.push(`读取 ${c("read")} 个文件`);
  if (c("search")) parts.push(`搜索 ${c("search")} 次文件`);
  if (c("cmd")) parts.push(`执行 ${c("cmd")} 条命令`);
  if (c("web")) parts.push(`调用 ${c("web")} 次工具`);
  if (c("memory")) parts.push(`调用 ${c("memory")} 次记忆工具`);
  if (c("think")) parts.push(`思考 ${c("think")} 次`);
  if (c("task")) parts.push(`调用 ${c("task")} 次任务工具`);
  if (c("tool")) parts.push(`调用 ${c("tool")} 次工具`);
  if (parts.length && !parts[0].startsWith("已")) parts[0] = "已" + parts[0];
  for (const [status, label] of Object.entries({ running: "执行中", error: "失败", interrupted: "已中断" })) {
    const count = steps.filter(step => step.status === status).length;
    if (count) parts.push(`${label} ${count} 次调用`);
  }
  return parts.join("，");
}

function StepLine({ s, rich, open, onClick }: { s: ToolStep; rich?: boolean; open?: boolean; onClick?: () => void }) {
  const Icon = ICON[s.kind];
  const isFile = s.kind === "read" || s.kind === "write" || s.kind === "edit" || s.kind === "delete";
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted transition-colors",
        rich && "hover:bg-hover",
        open && "bg-hover",
      )}
    >
      <Icon size={15} strokeWidth={1.7} className="shrink-0 text-faint" />
      <span className="max-w-[45%] shrink-0 truncate text-fg/80" title={s.title}>{s.status === "ok" && (isFile || s.kind === "cmd") ? VERB[s.kind] : s.status ? s.title : s.kind === "cmd" ? VERB.cmd : s.title || VERB[s.kind]}</span>
      {s.kind === "cmd" && !s.status ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{s.title}</span>
          <span className="text-faint">·</span>
          <span className="truncate font-mono text-[0.92em] text-fg/70">{s.target}</span>
        </span>
      ) : (
        <span className={cn("truncate", isFile ? "text-faint" : "font-mono text-[0.92em] text-faint")}>{s.target}</span>
      )}
      {rich && (
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {s.status && <span className={cn("text-[11px]", s.status === "error" ? "text-red-500" : "text-faint")}>{{ running: "执行中", ok: "完成", error: "失败", interrupted: "中断" }[s.status]}</span>}
          {s.exit !== undefined && (
            <span className={cn("rounded px-1.5 text-[11px] font-medium", s.exit === 0 ? "bg-accent-soft text-accent" : "bg-red-500/10 text-red-500")}>
              {s.exit === 0 ? "exit 0" : `exit ${s.exit}`}
            </span>
          )}
          {s.diff && (
            <span className="font-mono text-[11px]">
              {s.diff.add && <span className="text-emerald-600 dark:text-emerald-400">+{s.diff.add.length}</span>}
              {s.diff.del && <span className="ml-1 text-red-500">-{s.diff.del.length}</span>}
            </span>
          )}
          {s.duration && <span className="text-[11px] text-faint">{s.duration}</span>}
          {(s.output || s.diff) && <ChevronRight size={14} className={cn("text-faint transition-transform", open && "rotate-90")} />}
        </span>
      )}
    </button>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg"
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function StepDetail({ s }: { s: ToolStep }) {
  if (s.diff) {
    return (
      <div className="animate-fade ml-7 mr-1 mb-2 mt-1 overflow-hidden rounded-xl bg-term shadow-soft">
        <div className="flex items-center justify-between bg-deep/60 px-3 py-1.5 text-xs text-muted dark:bg-black/20">
          <span className="font-mono">{s.target}</span>
          <CopyBtn text={(s.diff.add || []).join("\n")} />
        </div>
        <div className="selectable overflow-x-auto py-1.5 font-mono text-[12px] leading-[1.7]">
          {s.diff.ctx?.map((l, i) => (
            <div key={"c" + i} className="flex px-3 text-faint"><span className="w-5 shrink-0 select-none"> </span>{l}</div>
          ))}
          {s.diff.del?.map((l, i) => (
            <div key={"d" + i} className="flex bg-red-500/10 px-3 text-red-700 dark:text-red-300"><span className="w-5 shrink-0 select-none">-</span><span className="whitespace-pre">{l}</span></div>
          ))}
          {s.diff.add?.map((l, i) => (
            <div key={"a" + i} className="flex bg-emerald-500/10 px-3 text-emerald-800 dark:text-emerald-300"><span className="w-5 shrink-0 select-none">+</span><span className="whitespace-pre">{l || " "}</span></div>
          ))}
        </div>
      </div>
    );
  }
  if (!s.output) return null;
  return (
    <div className="animate-fade ml-7 mr-1 mb-2 mt-1 overflow-hidden rounded-xl bg-term shadow-soft">
      <div className="flex items-center justify-between bg-deep/60 px-3 py-1.5 text-xs text-muted dark:bg-black/20">
        <span className="truncate font-mono">{s.target}</span>
        <CopyBtn text={s.output} />
      </div>
      <pre className="selectable max-h-64 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-[1.65] text-fg/85">{s.output}</pre>
    </div>
  );
}

export function ToolSteps({ steps, rich, defaultOpen = false }: { steps: ToolStep[]; rich?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<number | null>(null);
  return (
    <div className="min-w-0">
      <button aria-expanded={open} onClick={() => setOpen((v) => !v)} className="group flex max-w-full items-center gap-1 rounded-md py-1 text-left text-sm text-muted transition-colors hover:text-fg">
        <span>{summarize(steps)}</span>
        <ChevronRight size={14} className={cn("text-faint transition-transform group-hover:text-fg", open && "rotate-90")} />
      </button>
      {open && (
        <div className="animate-fade -ml-2 mt-1 flex flex-col gap-0.5">
          {steps.map((s, i) => (
            <div key={i}>
              <StepLine s={s} rich={rich} open={detail === i} onClick={rich ? () => setDetail(detail === i ? null : i) : undefined} />
              {rich && detail === i && <StepDetail s={s} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
