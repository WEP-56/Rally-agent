// Dedicated native host: a PTY failure cannot crash the Electron main process.
import { spawn as spawnProcess } from "node:child_process";
import { join } from "node:path";
import { release } from "node:os";
import { spawn, type IPty } from "node-pty";
import type { TerminalCommand, TerminalMessage } from "./terminal-protocol.ts";

if (!process.send) throw new Error("TERMINAL_HOST_REQUIRES_IPC");
let pty: IPty | undefined; let seq = 0; let pending = 0; let acked = 0;
const lengths = new Map<number, number>();
// Retain the root until the parent kills the entire tree, including shell descendants.
setInterval(() => {}, 60000);
const send = (message: TerminalMessage) => { if (process.connected) process.send?.(message, () => {}); };
process.on("message", (message: TerminalCommand) => {
	try {
		switch (message.type) {
			case "start": {
				if (pty) throw new Error("TERMINAL_ALREADY_STARTED");
				// Tabby's session integration gates the bundled DLL on Windows 10 2004+
				// and falls back to system ConPTY if the DLL cannot load (MIT; notices included).
				const options = { name: "xterm-256color", ...message.size, cwd: message.cwd, env: message.env, useConpty: true, useConptyDll: process.platform === "win32" && Number(release().split(".")[2]) >= 19041 };
				try { pty = spawn(message.shell, message.args, options); }
				catch (error) { if (!options.useConptyDll) throw error; pty = spawn(message.shell, message.args, { ...options, useConptyDll: false }); }
				pty.onData(data => {
					// Watermarks and xterm write acknowledgements follow xterm.js's MIT flow-control guide.
					for (let offset = 0; offset < data.length; offset += 16384) { const chunk = data.slice(offset, offset + 16384); lengths.set(++seq, chunk.length); pending += chunk.length; send({ type: "data", seq, data: chunk }); }
					if (pending >= 131072) pty!.pause();
				});
				pty.onExit(event => send({ type: "exit", exitCode: event.exitCode }));
				send({ type: "ready", pid: pty.pid }); break;
			}
			case "write": pty?.write(message.data); break;
			case "resize": pty?.resize(message.size.cols, message.size.rows); break;
			case "ack": {
				if (!Number.isSafeInteger(message.seq) || message.seq <= acked || message.seq > seq) break;
				for (const [key, length] of lengths) if (key <= message.seq) { pending -= length; lengths.delete(key); }
				acked = message.seq; if (pending < 32768) pty?.resume(); break;
			}
		}
	} catch (error) { send({ type: "error", error: error instanceof Error ? error.message : String(error) }); }
});
process.on("disconnect", () => {
	// Main-process crashes must not leave the user's terminal tree running. This helper
	// targets our still-live root; normal close uses the parent's exact identity check.
	if (process.platform === "win32") {
		const killer = spawnProcess(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true, detached: true, stdio: "ignore" });
		killer.on("error", () => { try { pty?.kill(); } finally { process.exit(1); } }); killer.unref();
	} else { try { pty?.kill(); } finally { process.exit(0); } }
});
