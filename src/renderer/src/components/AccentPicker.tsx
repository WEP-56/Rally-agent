import { argbFromHex, Hct, hexFromArgb } from "@material/material-color-utilities";
import { Check, Palette } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { ActionButton } from "../md3/interactive";
import { SPRING_LAYOUT } from "../md3/springs";
import { ACCENTS } from "../store";
import { cn } from "../utils/cn";

export function AccentPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const editorId = useId();
  return <div className="min-w-0 w-full md:max-w-[280px]">
    <div className="flex flex-wrap items-center gap-2">
      {ACCENTS.map(accent => <ActionButton
        key={accent.value} title={accent.name} aria-label={accent.name} aria-pressed={value.toLowerCase() === accent.value.toLowerCase()}
        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.86 }}
        onClick={() => { setExpanded(false); onChange(accent.value); }}
        className={cn("flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full", value.toLowerCase() === accent.value.toLowerCase() && "ring-2 ring-md-primary ring-offset-2 ring-offset-md-surface-low")}
        style={{ background: accent.value }}
      >{value.toLowerCase() === accent.value.toLowerCase() && <Check size={16} className="text-white" />}</ActionButton>)}
      <ActionButton aria-label="自定义强调色" aria-expanded={expanded} aria-controls={editorId} onClick={() => setExpanded(!expanded)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-md-secondary-container px-3 text-xs text-md-on-secondary-container">
        <Palette size={14} />自由取色
      </ActionButton>
    </div>
    <AnimatePresence initial={false}>
      {expanded && <motion.div id={editorId} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING_LAYOUT} className="overflow-hidden">
        <ColorEditor value={value} onChange={onChange} />
      </motion.div>}
    </AnimatePresence>
  </div>;
}

/** The same HCT color space as the app theme, without a native browser color dialog. */
function ColorEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [color, setColor] = useState(() => {
    const hct = Hct.fromInt(argbFromHex(value));
    return { hue: hct.hue, chroma: hct.chroma, tone: hct.tone };
  });
  const [hex, setHex] = useState(value);
  const validHex = /^#[0-9a-f]{6}$/i.test(hex);
  const axes = [
    { key: "hue" as const, label: "色相", max: 360 },
    { key: "chroma" as const, label: "鲜艳度", max: 150 },
    { key: "tone" as const, label: "明亮度", max: 100 },
  ];
  return <div className="mt-3 rounded-2xl bg-md-surface-lowest p-3">
    {axes.map(axis => {
      const stops = Array.from({ length: 13 }, (_, index) => {
        const sample = { ...color, [axis.key]: axis.max * index / 12 };
        return hexFromArgb(Hct.from(sample.hue, sample.chroma, sample.tone).toInt());
      });
      return <label key={axis.key} className="mb-2 block text-xs text-muted">
        <span className="flex justify-between gap-2">{axis.label}<span className="tabular-nums">{Math.round(color[axis.key])}</span></span>
        <input type="range" aria-label={axis.label} min={0} max={axis.max} step={1} value={color[axis.key]} className="accent-color-slider"
          style={{ backgroundImage: `linear-gradient(to right, ${stops.join(", ")})` }}
          onChange={event => {
            const next = { ...color, [axis.key]: Number(event.target.value) };
            const nextHex = hexFromArgb(Hct.from(next.hue, next.chroma, next.tone).toInt());
            setColor(next); setHex(nextHex); onChange(nextHex);
          }} />
      </label>;
    })}
    <label className="block text-xs text-muted">颜色值
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-xl" style={{ background: value }} />
        <input type="text" aria-label="强调色十六进制值" aria-invalid={!validHex} value={hex} maxLength={7} spellCheck={false} autoCapitalize="off"
          className="min-w-0 w-full rounded-xl bg-md-surface-high px-3 py-2 font-mono text-sm text-fg"
          onChange={event => {
            const next = event.target.value; setHex(next);
            if (/^#[0-9a-f]{6}$/i.test(next)) {
              const hct = Hct.fromInt(argbFromHex(next));
              setColor({ hue: hct.hue, chroma: hct.chroma, tone: hct.tone }); onChange(next);
            }
          }} />
      </div>
    </label>
    {!validHex && <p role="status" className="mt-1 text-xs text-danger">请输入 # 加六位颜色值，如 #33658E</p>}
  </div>;
}
