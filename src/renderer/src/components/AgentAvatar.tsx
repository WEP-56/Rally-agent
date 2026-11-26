import { useApp } from "../store";
import { cn } from "../utils/cn";
import { RallyMark } from "./brand";
import { MochiMascotSvg } from "../mascot/MochiMascotSvg";
import { DEFAULT_PHYSICS } from "../mascot/types";
import { useContext } from "react";
import { MascotStateContext } from "../mascot/state";

/** Animate only the two prominent identity slots; message/list avatars stay lightweight. */
export function AgentAvatar({ size = 32, className, glow, mascot = true, animated = false, interactive = false, paused = false }: {
  size?: number;
  className?: string;
  glow?: boolean;
  mascot?: boolean;
  animated?: boolean;
  interactive?: boolean;
  paused?: boolean;
}) {
  const { config } = useApp();
  const state = useContext(MascotStateContext);
  if (config.avatar?.startsWith("data:image/png;base64,")) {
    return <img src={config.avatar} alt={config.name} width={size} height={size} draggable={false}
      className={cn("shrink-0 select-none rounded-[28%] object-cover", glow && "rally-glow", className)} style={{ width: size, height: size }} />;
  }
  if (!mascot) return <RallyMark size={size} className={className} glow={glow} />;
  return <MochiMascotSvg state={state} physics={DEFAULT_PHYSICS} size={size}
    compactMode={size < 80} interactive={interactive} paused={paused || !animated} reducedMotion={config.reduceMotion || !animated}
    className={cn("shrink-0", className)} />;
}
