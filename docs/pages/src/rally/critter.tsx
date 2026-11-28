import type { ReactNode } from "react";
import { cn } from "../utils/cn";

/* Rally 的 Critter：按任务 ID 确定性生成的像素小同事（照搬 renderer 的 brand.tsx 算法）。
 * 精灵图只存左半边，渲染时镜像；# 主体 · m 阴影 · e 眼睛 · w 白色高光 */
const SPRITES: string[][] = [
  [".....", ".#...", ".##..", ".####", ".#e##", ".####", ".###m", "..###", "...##", "....."],
  [".....", "..###", ".####", "#####", "#e###", "#####", "###mm", ".####", ".#.##", "....."],
  ["....#", "....#", ".####", ".#mmm", ".#mem", ".#mmm", ".####", "..###", ".#.#.", "....."],
  [".....", "..###", ".####", "#####", "#e###", "#####", "#####", "#####", "#.#.#", "....."],
  [".#...", "..#..", "..###", ".####", ".#e##", "#####", "#.###", "..###", ".#.##", "....."],
];

export const CRITTER_COLORS = ["#7c5cf0", "#ec4899", "#3b82f6", "#22a06b", "#f08a24", "#e6b422", "#14b8a6", "#ef4455"];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r},${g},${b})`;
}

export function critterColor(seed: string) {
  return CRITTER_COLORS[(hash(seed) >>> 4) % CRITTER_COLORS.length];
}

export function Critter({ seed, size = 40, className }: { seed: string; size?: number; className?: string }) {
  const h = hash(seed);
  const rows = SPRITES[h % SPRITES.length];
  const body = critterColor(seed);
  const dark = shade(body, 0.28);
  const rects: ReactNode[] = [];
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
      className={cn("flex shrink-0 items-center justify-center rounded-[30%]", className)}
      style={{ width: size, height: size, background: `color-mix(in srgb, ${body} 15%, var(--md-sys-color-surface-container-lowest))` }}
    >
      <svg viewBox="0 0 10 10" shapeRendering="crispEdges" style={{ width: size * 0.74, height: size * 0.74 }} aria-hidden>
        {rects}
      </svg>
    </div>
  );
}
