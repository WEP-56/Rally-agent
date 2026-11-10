import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface ProcessIdentity { pid: number; created: string }
export type ProcessStopResult = "missing" | "identity_mismatch" | "terminated" | "killed";

/** Windows timestamps are FILETIME-resolution ticks, never rounded JS milliseconds.
 * The open process handle pins the PID throughout verification and termination:
 * https://learn.microsoft.com/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information
 */
const windowsProcess = String.raw`
$ErrorActionPreference = 'Stop'
try { $targetProcess = [System.Diagnostics.Process]::GetProcessById(TARGET_PID) }
catch [System.ArgumentException] { Write-Output 'missing'; exit 0 }
try {
  $null = $targetProcess.Handle
  if ($targetProcess.HasExited) { Write-Output 'missing'; exit 0 }
  $created = $targetProcess.StartTime.ToUniversalTime().Ticks.ToString()
  ACTION
} finally { $targetProcess.Dispose() }
`;

export async function processIdentity(pid: number): Promise<ProcessIdentity | undefined> {
	assertPid(pid);
	if (process.platform === "win32") {
		const created = await powershell(windowsProcess.replace("TARGET_PID", String(pid)).replace("ACTION", "Write-Output $created"));
		if (created === "missing") return;
		if (!/^\d+$/.test(created)) throw new Error("PROCESS_IDENTITY_INVALID: 无法读取进程创建时间");
		return { pid, created: `win:${created}` };
	}
	if (process.platform === "linux") {
		try {
			const [stat, boot] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile("/proc/sys/kernel/random/boot_id", "utf8")]);
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			if (fields[0] === "Z") return;
			return { pid, created: `linux:${boot.trim()}:${fields[19]}` };
		} catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return; throw error; }
	}
	throw new Error("PROCESS_PLATFORM_UNSUPPORTED: 此系统尚不支持精确进程身份核验");
}

export async function stopProcessTree(identity: ProcessIdentity, graceMs = 5000): Promise<ProcessStopResult> {
	assertPid(identity.pid);
	// An old host PID may have been reused by this Rally instance itself.
	if (identity.pid === process.pid) return "identity_mismatch";
	if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 60000) throw new Error("PROCESS_GRACE_INVALID");
	if (process.platform === "win32") {
		if (!/^win:\d+$/.test(identity.created)) return "identity_mismatch";
		const action = String.raw`
  if ($created -ne 'EXPECTED') { Write-Output 'identity_mismatch'; exit 0 }
  $taskkillPath = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  if (GRACE -gt 0) {
    $ErrorActionPreference = 'Continue'
    & $taskkillPath /PID TARGET /T 2>&1 | Out-Null
    $gentleExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($targetProcess.WaitForExit(GRACE)) {
      if ($gentleExitCode -ne 0) { throw 'PROCESS_STOP_FAILED: taskkill did not confirm the entire tree' }
      Write-Output 'terminated'; exit 0
    }
  }
  $ErrorActionPreference = 'Continue'
  & $taskkillPath /PID TARGET /T /F 2>&1 | Out-Null
  $killExitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if (-not $targetProcess.WaitForExit(5000)) { throw 'PROCESS_STOP_FAILED: process is still alive' }
  if ($killExitCode -ne 0) { throw 'PROCESS_STOP_FAILED: taskkill did not confirm the entire tree' }
  Write-Output 'killed'
`;
		const result = await powershell(windowsProcess.replace("TARGET_PID", String(identity.pid)).replace("ACTION",
			action.replace("EXPECTED", identity.created.slice(4)).replaceAll("GRACE", String(graceMs)).replaceAll("TARGET", String(identity.pid))), graceMs + 15000);
		if (!["missing", "identity_mismatch", "terminated", "killed"].includes(result)) throw new Error("PROCESS_STOP_FAILED: 无法确认终止结果");
		return result as ProcessStopResult;
	}
	const current = await processIdentity(identity.pid);
	if (!current) return "missing";
	if (current.created !== identity.created) return "identity_mismatch";
	// Managed hosts are session/group leaders; commands remain in that group.
	const signal = (value: NodeJS.Signals) => { try { process.kill(-identity.pid, value); } catch (error) {
		if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") throw error;
	} };
	if (graceMs) {
		signal("SIGTERM");
		const end = Date.now() + graceMs;
		while (Date.now() < end) {
			if (!(await processIdentity(identity.pid))) break;
			await delay(Math.min(50, Math.max(1, end - Date.now())));
		}
	}
	// The host ignores SIGTERM so descendants cannot escape escalation by outliving it.
	signal("SIGKILL");
	for (let i = 0; i < 100; i++) { if (!(await processIdentity(identity.pid))) return "killed"; await delay(50); }
	throw new Error("PROCESS_STOP_FAILED: 进程仍在运行");
}

function assertPid(pid: number): void {
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("PROCESS_PID_INVALID");
}

function powershell(script: string, timeout = 15000): Promise<string> {
	const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return new Promise((resolve, reject) => execFile(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
		{ windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}
