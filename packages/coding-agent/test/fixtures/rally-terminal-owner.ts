import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { TerminalSession } from "../../../../src/main/terminal-session.ts";
const session = new TerminalSession({ cwd: process.argv[2], size: { cols: 120, rows: 40 }, shell: process.execPath, args: [process.argv[3]], env: process.env }, message => {
	if (message.type === "data") session.ack(message.seq);
});
await session.start(); session.write("spawn\r");
const file = join(process.argv[2], "descendant.pid");
const timer = setInterval(() => { if (existsSync(file)) { clearInterval(timer); process.send?.({ descendant: Number(readFileSync(file, "utf8")) }); } }, 20);
process.on("message", () => { void session.close().then(() => process.exit(0)); });
