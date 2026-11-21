import { useApp } from "../store";
import { cn } from "../utils/cn";
import { RallyMark } from "./brand";

/** Personal identity image; app branding and worker critters keep their own icons. */
export function AgentAvatar({ size = 32, className, glow }: { size?: number; className?: string; glow?: boolean }) {
	const { config } = useApp();
	if (!config.avatar?.startsWith("data:image/png;base64,")) return <RallyMark size={size} className={className} glow={glow} />;
	return <img src={config.avatar} alt={config.name} width={size} height={size} draggable={false}
		className={cn("shrink-0 select-none rounded-[28%] object-cover", glow && "rally-glow", className)} style={{ width: size, height: size }} />;
}
