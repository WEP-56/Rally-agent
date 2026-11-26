import { createContext, useEffect, useState } from "react";
import type { ChatHeaderState, ChatActivity } from "../../../shared/ipc";
import type { AgentStateId } from "./types";

export const MascotStateContext = createContext<AgentStateId>("idle");

const ACTIVITY_POSES: Record<ChatActivity, AgentStateId> = {
  thinking: "thinking",
  replying: "replying",
  querying: "searching",
  planning: "orchestrating",
  orchestrating: "orchestrating",
  compacting: "thinking",
  tooling: "coding",
};

/** The mascot reflects only the main agent's live activity and result. */
export function resolveMascotState(header: ChatHeaderState, now: number): AgentStateId {
  if (header.activity) return ACTIVITY_POSES[header.activity];
  const result = header.loopResult;
  if (result && now >= result.at && now - result.at < 3000 && result.outcome !== "aborted") {
    return result.outcome === "completed" ? "completed" : "error";
  }
  return "idle";
}

/** One clock for both slots; snapshots older than the celebration window stay idle. */
export function useMascotState(header: ChatHeaderState): AgentStateId {
  const [now, setNow] = useState(Date.now);
  const at = header.loopResult?.at;
  useEffect(() => {
    setNow(Date.now());
    if (at === undefined) return;
    const remaining = at + 3000 - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 1);
    return () => window.clearTimeout(timer);
  }, [at]);
  return resolveMascotState(header, Math.max(now, Date.now()));
}
