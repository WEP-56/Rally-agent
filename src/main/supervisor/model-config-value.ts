import { resolveConfigValueOrThrow, type ConfigValueResolver } from "@rally/coding-agent";
import { managedConfigCommand } from "./config-command.ts";
import type { ProcessRegistry } from "./process-registry.ts";

/** The shared model runtime owns these commands globally, not as worker tools. */
export function managedModelConfigValue(registry: ProcessRegistry, cwd: string): ConfigValueResolver {
 return async (value, description, env, signal) => {
  signal?.throwIfAborted();
  const result = value.startsWith("!")
   ? await managedConfigCommand(registry, { kind: "config" }, cwd, value.slice(1), signal)
   : resolveConfigValueOrThrow(value, description, env);
  signal?.throwIfAborted();
  return result;
 };
}
