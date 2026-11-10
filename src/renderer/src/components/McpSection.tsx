import { useEffect, useState } from "react";
import { Plug, RefreshCw, Trash2 } from "lucide-react";
import type { McpConfigurationState, McpRiskTier } from "../../../shared/mcp";
import { Button, Segmented, Toggle } from "./ui";

export function McpSection() {
	const [state, setState] = useState<McpConfigurationState | null>(null);
	const [json, setJson] = useState("");
	const [view, setView] = useState<"list" | "json">("list");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(true);
	const [toolName, setToolName] = useState("");
	const [tier, setTier] = useState<McpRiskTier>("reversible");
	const dirty = state !== null && json !== state.json;
	useEffect(() => {
		let mounted = true;
		void window.rally.mcp.getState().then((next) => { if (mounted) { setState(next); setJson(next.json); } })
			.catch((reason: unknown) => { if (mounted) setError(String(reason)); })
			.finally(() => { if (mounted) setBusy(false); });
		return () => { mounted = false; };
	}, []);
	async function change(action: () => Promise<McpConfigurationState>) {
		setBusy(true); setError("");
		try { const next = await action(); setState(next); setJson(next.json); }
		catch (reason) { setError(String(reason)); }
		finally { setBusy(false); }
	}
	return <>
		<div className="mb-4 flex items-center justify-between gap-2">
			<Segmented value={view} onChange={setView} options={[{ value: "list", label: "列表" }, { value: "json", label: "JSON" }]} />
			<div className="flex gap-2"><Button disabled={busy || dirty} onClick={() => void change(() => window.rally.mcp.getState())}><RefreshCw size={13} />刷新</Button><Button variant="primary" disabled={busy} onClick={() => setView("json")}>添加或编辑服务器</Button></div>
		</div>
		<p className="mb-4 text-xs leading-relaxed text-muted">之后启动的任务会连接已启用的服务器，主对话不使用 MCP。这里显示配置状态，不代表连接成功。</p>
		{error && <p role="alert" className="mb-4 break-words text-xs text-red-500">{error}</p>}
		{state?.errors.map((message) => <p key={message} role="alert" className="mb-2 break-all text-xs text-red-500">{message}</p>)}
		{dirty && <p className="mb-3 text-xs text-muted">JSON 有未保存修改，请保存后再修改列表。</p>}
		{view === "json" ? <>
			<p className="mb-2 text-xs text-faint">在 mcpServers 中按名称添加服务器。stdio 使用 command 与 args 数组，HTTP 使用 url；可保留 env、headers 和其他 Pi 支持的字段。</p>
			<textarea aria-label="MCP JSON 配置" spellCheck={false} disabled={busy} className="selectable min-h-80 w-full rounded-2xl bg-term p-4 font-mono text-xs leading-relaxed text-fg/85 outline-none" value={json} onChange={(event) => setJson(event.target.value)} />
			<div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy || !dirty} onClick={() => void change(() => window.rally.mcp.save(json))}>保存配置</Button></div>
		</> : <fieldset disabled={busy || dirty} className="flex min-w-0 flex-col gap-1 rounded-2xl bg-sunken p-1">
			{state?.servers.map((server) => <div key={server.name} className="flex min-h-[56px] items-center gap-4 rounded-xl bg-panel px-4 py-3 dark:bg-raised/60">
				<Plug size={16} className="shrink-0 text-faint" />
				<div className="min-w-0 flex-1"><div className="text-sm font-medium">{server.name} <span className="text-[10px] uppercase text-faint">{server.transport}</span></div><div className="mt-1 truncate font-mono text-xs text-faint" title={server.address}>{server.address}</div></div>
				<button aria-label={`删除 ${server.name}`} onClick={() => void change(() => window.rally.mcp.update(server.name, null))} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
				<Toggle checked={server.enabled} onChange={(enabled) => void change(() => window.rally.mcp.update(server.name, enabled))} />
			</div>)}
			{state?.servers.length === 0 && <p className="p-4 text-xs text-faint">尚未配置 MCP 服务器</p>}
		</fieldset>}
		<div className="mt-6 text-sm font-medium">工具风险档</div>
		<p className="mb-3 mt-1 text-xs leading-relaxed text-muted">列表来自任务曾发现的工具及已保存的设置，不表示当前在线。默认可逆；有对外代价的调用会执行并提示、留审计；不可逆调用会等待确认。保存后从下一次调用起生效，已经发出的确认仍需处理。</p>
		<fieldset disabled={busy || dirty} className="space-y-2">
			{state?.tools.map((tool) => <div key={tool.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3 py-2">
				<span className="min-w-0 break-all font-mono text-xs text-muted">{tool.name}</span>
				<select aria-label={`${tool.name} 风险档`} value={tool.tier} onChange={(event) => void change(() => window.rally.mcp.setTier(tool.name, event.target.value as McpRiskTier))} className="rounded-md bg-panel px-2 py-1 text-xs"><RiskOptions /></select>
			</div>)}
			<div className="flex flex-wrap gap-2"><input aria-label="MCP 工具完整名称" placeholder="mcp__server__tool" value={toolName} onChange={(event) => setToolName(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-sunken px-3 py-2 font-mono text-xs outline-none" /><select aria-label="新工具风险档" value={tier} onChange={(event) => setTier(event.target.value as McpRiskTier)} className="rounded-lg bg-sunken px-2 py-1 text-xs"><RiskOptions /></select><Button disabled={!toolName.trim()} onClick={() => void change(() => window.rally.mcp.setTier(toolName.trim(), tier))}>保存风险档</Button></div>
		</fieldset>
	</>;
}

function RiskOptions() {
	return <><option value="reversible">可逆</option><option value="external">有对外代价</option><option value="irreversible">不可逆</option></>;
}
