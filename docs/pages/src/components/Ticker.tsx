import { TICKER_ITEMS } from "../data";
import { cn } from "../utils/cn";

/** 能力跑马灯：悬停时暂停 */
export function Ticker() {
  const row = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="group relative overflow-hidden border-y border-md-outline-variant/50 bg-md-surface-low py-3.5 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div className="animate-marquee flex w-max items-center group-hover:[animation-play-state:paused]">
        {row.map((item, i) => (
          <span
            key={i}
            className="font-display mr-3 inline-flex items-center gap-2 rounded-full border border-md-outline-variant/60 bg-md-surface-lowest px-4 py-1.5 text-[13px] font-bold whitespace-nowrap text-md-on-surface-variant"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", i % 3 === 0 ? "bg-mochi-coral" : i % 3 === 1 ? "bg-mochi-gold" : "bg-mochi-violet")} />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
