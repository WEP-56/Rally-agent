import { useId } from "react";
import markUrl from "../assets/rally-mark.png";
import { cn } from "../utils/cn";

/** The real Rally app icon (ink squircle + R + orbit + spark). */
export function RallyMark({ size = 32, className, glow }: { size?: number; className?: string; glow?: boolean }) {
  return (
    <img
      src={markUrl}
      width={size}
      height={size}
      alt="Rally"
      draggable={false}
      className={cn("shrink-0 select-none", glow && "rally-glow", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Orbit ring with a small spark travelling along it — lifted straight from the icon's motif. */
export function OrbitRing({ size = 260, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="-100 -60 200 120"
      width={size}
      height={(size * 120) / 200}
      className={cn("pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`og-${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--c-accent)" stopOpacity="0" />
          <stop offset="0.35" stopColor="var(--c-accent)" stopOpacity="0.4" />
          <stop offset="0.7" stopColor="var(--c-accent)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--c-accent)" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <g transform="rotate(-22)">
        <ellipse rx="88" ry="30" fill="none" stroke={`url(#og-${id})`} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="420 140" />
        <g>
          <path d="M0,-6 Q0.8,-0.8 6,0 Q0.8,0.8 0,6 Q-0.8,0.8 -6,0 Q-0.8,-0.8 0,-6Z" fill="var(--c-accent)" />
          <animateMotion dur="16s" repeatCount="indefinite" path="M -88 0 A 88 30 0 1 1 88 0 A 88 30 0 1 1 -88 0" />
        </g>
      </g>
    </svg>
  );
}

/* ───────────── Critters: deterministic pixel colleagues for each task agent ───────────── */

// left half of a 10×10 sprite, mirrored. # body · m shade · e eye · w white
const SPRITES: string[][] = [
  // cat
  [".....", ".#...", ".##..", ".####", ".#e##", ".####", ".###m", "..###", "...##", "....."],
  // blob
  [".....", "..###", ".####", "#####", "#e###", "#####", "###mm", ".####", ".#.##", "....."],
  // robot
  ["....#", "....#", ".####", ".#mmm", ".#mem", ".#mmm", ".####", "..###", ".#.#.", "....."],
  // ghost
  [".....", "..###", ".####", "#####", "#e###", "#####", "#####", "#####", "#.#.#", "....."],
  // bug
  [".#...", "..#..", "..###", ".####", ".#e##", "#####", "#.###", "..###", ".#.##", "....."],
];

export const CRITTER_COLORS = ["#7c5cf0", "#ec4899", "#3b82f6", "#22a06b", "#f08a24", "#e6b422", "#14b8a6", "#ef4455"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `rgb(${r},${g},${b})`;
}

export function critterColor(seed: string) {
  return CRITTER_COLORS[(hash(seed) >> 4) % CRITTER_COLORS.length];
}

export function Critter({ seed, size = 40, tile = true, className }: { seed: string; size?: number; tile?: boolean; className?: string }) {
  const h = hash(seed);
  const rows = SPRITES[h % SPRITES.length];
  const body = critterColor(seed);
  const dark = shade(body, 0.28);
  const rects: React.ReactNode[] = [];
  rows.forEach((half, y) => {
    const full = half + half.split("").reverse().join("");
    full.split("").forEach((c, x) => {
      if (c === ".") return;
      const fill = c === "#" ? body : c === "m" ? dark : c === "e" ? "#16161f" : "#fff";
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={fill} />);
    });
  });
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center", tile && "rounded-[30%]", className)}
      style={{
        width: size,
        height: size,
        background: tile ? `color-mix(in srgb, ${body} 15%, var(--c-panel))` : undefined,
      }}
    >
      <svg viewBox="0 0 10 10" shapeRendering="crispEdges" style={{ width: size * (tile ? 0.74 : 1), height: size * (tile ? 0.74 : 1) }}>
        {rects}
      </svg>
    </div>
  );
}

/** A four-point spark, same glyph as the icon. */
export function Spark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="-8 -8 16 16" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M0,-7 Q0.9,-0.9 7,0 Q0.9,0.9 0,7 Q-0.9,0.9 -7,0 Q-0.9,-0.9 0,-7Z" />
    </svg>
  );
}
