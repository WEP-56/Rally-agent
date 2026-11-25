import childProcess, { type SpawnOptions } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { hideCodexConsole } from "./external-worker-spawn-policy.ts";

const originalSpawn = childProcess.spawn;
const patchedSpawn = ((command: string, argsOrOptions?: string[] | SpawnOptions, options?: SpawnOptions) => {
	if (Array.isArray(argsOrOptions)) {
		return Reflect.apply(originalSpawn, childProcess, [command, argsOrOptions, hideCodexConsole(command, options, process.platform)]);
	}
	return Reflect.apply(originalSpawn, childProcess, [command, hideCodexConsole(command, argsOrOptions ?? options, process.platform)]);
}) as typeof childProcess.spawn;

childProcess.spawn = patchedSpawn;
syncBuiltinESMExports();
