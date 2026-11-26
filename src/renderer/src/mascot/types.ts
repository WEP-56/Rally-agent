export type AgentStateId = "idle" | "thinking" | "searching" | "orchestrating" | "coding" | "replying" | "completed" | "error";

export interface PhysicsConfig {
  stiffness: number;
  damping: number;
  bounciness: number;
  speedMultiplier: number;
  followCursor: boolean;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  stiffness: 150,
  damping: 13,
  bounciness: 1.2,
  speedMultiplier: 1,
  followCursor: true,
};
