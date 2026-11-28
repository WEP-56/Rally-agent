import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Search, Square, X } from "lucide-react";
import { Reveal, SectionHead, SPRING_FAST, SPRING_PANEL } from "../components/ui";
import { cn } from "../utils/cn";
import { SimProvider, useSim } from "./engine";
import { ChatPane } from "./ChatPane";
import { RightPane } from "./RightPane";

const MIN_RATIO = 0.3;
const MAX_RATIO = 0.7;
const WIDE_QUERY = "(min-width: 768px)";

/** 桌面窗口：标题栏 + 左对话 + 右工位（可拖拽分隔）。移动端右侧变成覆盖层。 */
function WorkstationFrame() {
  const { rightOpen, ratio, setRatio, setRightOpen } = useSim();
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const box = frameRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = 1 - (event.clientX - box.left) / box.width;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setRatio]);

  const startDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    setDragging(true);
  };

  return (
    <div className="overflow-hidden rounded-[30px] border border-md-outline-variant/60 bg-md-surface-container shadow-pop">
      {/* 标题栏（对应 TitleBar） */}
      <div className="flex h-9 items-center gap-2 bg-md-surface-container px-3.5 select-none">
        <img src={`${import.meta.env.BASE_URL}images/rally-favicon.png`} alt="" className="h-4 w-4 rounded-[5px]" />
        <span className="font-display text-[12.5px] font-bold text-md-on-surface-variant">Rally</span>
        <span className="hidden truncate text-[12px] text-md-on-surface-variant/70 sm:inline">· 数字工位</span>
        <div className="ml-auto flex items-center gap-1 text-md-on-surface-variant/80">
          <span className="flex h-7 w-7 items-center justify-center rounded-full" aria-hidden>
            <Search size={14} strokeWidth={1.8} />
          </span>
          <span className="flex h-9 w-10 items-center justify-center" aria-hidden>
            <Minus size={14} strokeWidth={1.4} />
          </span>
          <span className="flex h-9 w-10 items-center justify-center" aria-hidden>
            <Square size={11} strokeWidth={1.4} />
          </span>
          <span className="flex h-9 w-10 items-center justify-center" aria-hidden>
            <X size={15} strokeWidth={1.3} />
          </span>
        </div>
      </div>

      <div ref={frameRef} className={cn("relative flex h-[600px] w-full gap-0 p-2 select-none md:h-[580px]", dragging && "cursor-col-resize")}>
        <div className="panel-chat min-w-0 flex-1 overflow-hidden rounded-[26px] shadow-soft">
          <ChatPane />
        </div>

        {wide ? (
          <motion.div
            initial={false}
            animate={{ width: rightOpen ? `${ratio * 100}%` : "0%", opacity: rightOpen ? 1 : 0 }}
            transition={dragging ? { duration: 0 } : SPRING_PANEL}
            className="flex shrink-0 overflow-hidden"
          >
            <Divider dragging={dragging} onPointerDown={startDrag} onReset={() => setRatio(0.46)} />
            <div className="min-w-0 flex-1 pl-0">
              <RightPane />
            </div>
          </motion.div>
        ) : (
          <AnimatePresence>
            {rightOpen && (
              <motion.div
                key="mobile-right"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={SPRING_PANEL}
                className="absolute inset-2 z-20"
              >
                <RightPane />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
      {!wide && !rightOpen && (
        <button
          type="button"
          onClick={() => setRightOpen(true)}
          className="w-full cursor-pointer border-t border-md-outline-variant/50 bg-md-surface-container py-2.5 text-xs font-bold text-md-primary"
        >
          打开工位
        </button>
      )}
    </div>
  );
}

function Divider({ dragging, onPointerDown, onReset }: { dragging: boolean; onPointerDown: (event: ReactPointerEvent) => void; onReset: () => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      title="拖拽调整宽度，双击恢复等分"
      className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center"
    >
      <motion.div
        initial={false}
        animate={{ height: dragging ? 60 : 38, scaleX: dragging ? 1.25 : 1 }}
        transition={SPRING_FAST}
        className={cn("w-[3px] rounded-full transition-colors", dragging ? "bg-md-primary" : "bg-transparent group-hover:bg-md-outline-variant")}
      />
    </div>
  );
}

export function WorkstationSection() {
  return (
    <section id="workstation" className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="我的数字工位"
          title={
            <>
              不用下载，先<span className="text-md-primary">坐到工位上</span>
            </>
          }
          desc="这是按 Rally 客户端界面复刻的简化版工位。左边跟它聊天，右边看任务。点建议开始一件事，拖动中间的分隔条，点开任何一个任务，在门禁卡上真的按下“允许”或“拒绝”。"
        />
        <Reveal>
          <SimProvider>
            <WorkstationFrame />
          </SimProvider>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-4 text-center text-xs font-semibold text-md-on-surface-variant/75">
            演示是预录的剧本：工具输出、时间与任务内容都是示意。客户端里 Rally 会真的打开浏览器、改你的文件，并在动手前先问你。
          </p>
        </Reveal>
      </div>
    </section>
  );
}
