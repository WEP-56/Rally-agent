// Run Pi's optional tool download/probe/extraction under the registered process root.
import { ensureTool } from "@rally/coding-agent";

const tool = process.argv[2];
if (tool !== "rg" && tool !== "fd") throw new Error("SEARCH_TOOL_INVALID");
const path = await ensureTool(tool);
process.stdout.write(JSON.stringify({ path: path ?? null }));
