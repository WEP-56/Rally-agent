import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check, Shield, X } from "lucide-react";
import { Critter } from "../rally/critter";
import { MochiMascotSvg } from "../rally/mascot/MochiMascotSvg";
import { DEFAULT_PHYSICS } from "../rally/mascot/types";
import { StatusBadge } from "../sim/parts";
import type { TaskStatus } from "../sim/types";
import { Reveal, SectionHead, SPRING_JELLY, Sparkle } from "./ui";
import { cn } from "../utils/cn";

/* 一条流水线 = 一只 Critter 接一件活。六个站点依次是：接单 → 读代码 → 改代码 → 跑测试 → 门禁 → 完成。 */
const STAGES = ["接单", "读代码", "改代码", "跑测试", "门禁", "完成"];
const GATE_STAGE = 4;
const DONE_STAGE = STAGES.length - 1;

interface Lane {
  seed: string;
  title: string;
  /** 门禁站的请求内容；为空表示可逆操作，直接放行 */
  gate: string | null;
  logs: string[];
}

const LANES: Lane[] = [
  {
    seed: "fix-dst",
    title: "修复夏令时边界用例",
    gate: "推送 fix/dst-boundary 到 origin",
    logs: ["收到，先拆成三步", "读 src/utils/date.ts", "夏令时缺口顺延 1 小时", "42 passed ✓", "推送是对外操作，先问你", "已推送，分支就位"],
  },
  {
    seed: "weekly",
    title: "生成本周周报并发邮件",
    gate: "发送周报到 you@qq.com",
    logs: ["拉取本周 14 条 issue", "归纳已完成与进行中", "写成 812 字草稿", "正文已备好", "发邮件不可撤回，等你确认", "周报已发出 📮"],
  },
  {
    seed: "tidy",
    title: "整理下载文件夹",
    gate: null,
    logs: ["扫描 47 个文件", "建 5 个分类目录", "按扩展名移动", "47/47 完成", "只移动，可逆，直接放行", "收拾好啦 ✨"],
  },
  {
    seed: "readme",
    title: "给 README 补一张架构图",
    gate: "提交 README 到 main 分支",
    logs: ["读 packages/ 与 src/main/", "画出四层分层", "写入 docs/architecture.md", "预览无误", "提交到 main，需要你点头", "已合并，欢迎回家 🏠"],
  },
];

/** 一条泳道独立循环。门禁站等待你点击；4.5 秒无人操作则自动允许，保证展示不会停住。 */
function useLane(lane: Lane, index: number) {
  const [stage, setStage] = useState(0);
  const [log, setLog] = useState(lane.logs[0]);
  const [gatePending, setGatePending] = useState(false);
  const [gateOutcome, setGateOutcome] = useState<"allow" | "deny" | null>(null);
  const resolveGate = useRef<((decision: "allow" | "deny") => void) | null>(null);

  useEffect(() => {
    let alive = true;
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const loop = async () => {
      await wait(900 + index * 350);
      while (alive) {
        setStage(0);
        setGateOutcome(null);
        setLog(lane.logs[0]);
        await wait(1100);
        for (let s = 1; s <= DONE_STAGE; s++) {
          if (!alive) return;
          if (s === GATE_STAGE && lane.gate) {
            setGatePending(true);
            setLog(lane.logs[GATE_STAGE]);
            const decision = await new Promise<"allow" | "deny">((resolve) => {
              resolveGate.current = resolve;
              window.setTimeout(() => resolve("allow"), 4500);
            });
            setGatePending(false);
            setGateOutcome(decision);
            if (!alive) return;
            if (decision === "deny") {
              setLog("好的，已取消，等你下次吩咐");
              await wait(2200);
              break;
            }
          }
          setStage(s);
          setLog(lane.logs[s]);
          await wait(850 + Math.random() * 500);
        }
        if (!alive) return;
        setStage(DONE_STAGE);
        setLog(lane.logs[DONE_STAGE]);
        await wait(2600);
      }
    };
    void loop();
    return () => {
      alive = false;
      resolveGate.current = null;
    };
  }, [lane, index]);

  const decide = (decision: "allow" | "deny") => resolveGate.current?.(decision);
  return { stage, log, gatePending, gateOutcome, decide };
}

/* ───────────────────────── 门禁槽 ─────────────────────────
 * 高度固定为 h-14：请求出现、被处理、消失都只在槽内交叉淡入淡出，
 * 卡片与整页的高度始终不变，滚动浏览后面的内容时不会抖动。 */

type GateState = "reversible" | "idle" | "pending" | "allow" | "deny";

const GATE_STRIP_STYLE: Record<GateState, string> = {
  reversible: "bg-rally-ok-container/40 text-rally-on-ok-container",
  idle: "border border-dashed border-md-outline-variant/70 text-md-on-surface-variant/75",
  pending: "bg-rally-warn-container text-rally-on-warn-container shadow-float",
  allow: "bg-rally-ok-container text-rally-on-ok-container",
  deny: "bg-md-surface-high text-md-on-surface-variant",
};

const GATE_STRIP_TEXT: Record<Exclude<GateState, "pending">, string> = {
  reversible: "可逆操作 · 无需确认，直接放行",
  idle: "门禁 · 暂无待处理请求",
  allow: "已允许 · 操作已执行",
  deny: "已拒绝 · 本次未执行",
};

function GateStrip({
  lane,
  pending,
  outcome,
  onDecide,
}: {
  lane: Lane;
  pending: boolean;
  outcome: "allow" | "deny" | null;
  onDecide: (decision: "allow" | "deny") => void;
}) {
  const state: GateState = !lane.gate ? "reversible" : pending ? "pending" : (outcome ?? "idle");
  return (
    <div data-gate-slot className="relative mt-4 h-14" aria-live="polite">
      <AnimatePresence initial={false}>
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.985, pointerEvents: "none" }}
          transition={SPRING_JELLY}
          className={cn("absolute inset-0 flex items-center gap-3 rounded-[20px] px-4 text-[13px] font-semibold", GATE_STRIP_STYLE[state])}
        >
          {state === "allow" || state === "reversible" ? (
            <Check size={16} className="shrink-0" />
          ) : state === "deny" ? (
            <X size={16} className="shrink-0" />
          ) : (
            <Shield size={16} className={cn("shrink-0", state === "idle" && "opacity-70")} />
          )}
          <span className="min-w-0 flex-1 truncate" title={state === "pending" ? (lane.gate ?? undefined) : undefined}>
            {state === "pending" ? lane.gate : GATE_STRIP_TEXT[state]}
          </span>
          {state === "pending" && (
            <span className="flex shrink-0 gap-2">
              <motion.button
                type="button"
                onClick={() => onDecide("deny")}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_JELLY}
                className="h-8 cursor-pointer rounded-full bg-md-surface-lowest/85 px-3.5 text-xs font-bold text-md-on-surface"
              >
                拒绝
              </motion.button>
              <motion.button
                type="button"
                onClick={() => onDecide("allow")}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_JELLY}
                className="h-8 cursor-pointer rounded-full bg-md-primary px-3.5 text-xs font-bold text-md-on-primary"
              >
                允许
              </motion.button>
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function LaneRow({ lane, index }: { lane: Lane; index: number }) {
  const { stage, log, gatePending, gateOutcome, decide } = useLane(lane, index);
  const done = stage === DONE_STAGE;
  const status: TaskStatus = gatePending ? "needs_gate" : done ? "done" : "running";
  const pct = (stage / DONE_STAGE) * 100;
  const bubbleX = pct < 14 ? "0%" : pct > 86 ? "-100%" : "-50%";

  return (
    <div className="rounded-[28px] border border-md-outline-variant/50 bg-md-surface-lowest/80 p-4 shadow-card md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
        <div className="flex min-w-0 items-center gap-3 md:w-[230px] md:shrink-0">
          <Critter seed={lane.seed} size={52} />
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-semibold text-md-on-surface">{lane.title}</div>
            <div className="mt-1">
              <StatusBadge status={status} />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 pt-10">
          <div className="relative mx-5 h-5">
            {/* 轨道 */}
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-md-surface-highest" />
            <motion.div className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-md-primary" animate={{ width: `${pct}%` }} transition={SPRING_JELLY} />

            {/* 站点 */}
            {STAGES.map((_, i) => (
              <span
                key={i}
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-md-surface-lowest ${i <= stage ? "bg-md-primary" : "bg-md-surface-highest"}`}
                style={{ left: `${(i / DONE_STAGE) * 100}%` }}
              />
            ))}

            {/* 气泡：说出当前在做什么 */}
            <motion.div className="pointer-events-none absolute bottom-full mb-3 w-0" animate={{ left: `${pct}%` }} transition={SPRING_JELLY}>
              <motion.div animate={{ x: bubbleX }} transition={SPRING_JELLY} className="max-w-[260px] rounded-2xl bg-md-surface-high px-3 py-1 text-[12px] font-semibold whitespace-nowrap text-md-on-surface-variant shadow-soft">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={log} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="inline-block">
                    {log}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            </motion.div>

            {/* Critter 本体：跟着站点滑动，到站时跳一下，门禁时抖一抖 */}
            <motion.div className="absolute top-1/2 w-0 -translate-y-1/2" animate={{ left: `${pct}%` }} transition={SPRING_JELLY}>
              <motion.div
                className="-translate-x-1/2"
                animate={gatePending ? { rotate: [-6, 6, -6] } : done ? { y: [0, -14, 0] } : { rotate: 0, y: 0 }}
                transition={gatePending ? { repeat: Infinity, duration: 0.7 } : { duration: 0.6 }}
              >
                <Critter seed={lane.seed} size={44} className="shadow-float" />
              </motion.div>
            </motion.div>
          </div>

          <div className="relative mx-5 mt-3 h-4 text-[10.5px] font-bold text-md-on-surface-variant/70">
            {STAGES.map((name, i) => (
              <span
                key={name}
                className={`absolute top-0 whitespace-nowrap transition-colors ${i === stage ? "text-md-primary" : ""}`}
                style={{
                  left: `${(i / DONE_STAGE) * 100}%`,
                  transform: i === 0 ? "none" : i === DONE_STAGE ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 门禁槽：固定高度，请求在槽内淡入淡出，不改变卡片高度 */}
      <GateStrip lane={lane} pending={gatePending} outcome={gateOutcome} onDecide={decide} />
    </div>
  );
}

export function Critters() {
  return (
    <section id="critters" className="relative overflow-hidden bg-md-surface py-20 md:py-28">
      <div className="dotgrid absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_60%_at_20%_10%,black,transparent)]" aria-hidden />
      <Sparkle className="absolute top-16 right-[7%] h-7 w-7" delay={0.4} />
      <div className="relative mx-auto max-w-6xl px-5">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
          <SectionHead
            kicker="聪明的小家伙"
            title={
              <>
                每只 Critter 都是<span className="text-md-primary">一位同事</span>
              </>
            }
            desc="派给它的活，就是它的工位和进度。它会读代码、改代码、跑测试，动手前会把门禁请求递到你面前。循环播放中，你也可以直接点“允许”或“拒绝”。"
          />
          <Reveal delay={0.1} className="mb-10 hidden lg:block md:mb-14">
            <MochiMascotSvg state="orchestrating" physics={DEFAULT_PHYSICS} size={150} perfMode="auto" compactMode />
          </Reveal>
        </div>

        <div className="flex flex-col gap-4">
          {LANES.map((lane, index) => (
            <Reveal key={lane.seed} delay={index * 0.06}>
              <LaneRow lane={lane} index={index} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <p className="mt-6 text-center text-xs font-semibold text-md-on-surface-variant/75">
            每只 Critter 的样子由任务 ID 决定，同一个任务永远是同一只。门禁只拦“不可逆”的操作，其他工具直接放行。
          </p>
        </Reveal>
      </div>
    </section>
  );
}
