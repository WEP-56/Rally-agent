import { useEffect, useState } from "react";
import { Plug, RefreshCw, Trash2, Pencil, Plus } from "lucide-react";
import type { McpConfigurationState, McpExposure, McpRiskTier, McpServerSettings } from "../../../shared/mcp";
import { Button, Segmented, Toggle } from "./ui";

export function McpSection() {
	const [state, setState] = useState<McpConfigurationState | null>(null);
	const [json, setJson] = useState("");
	const [view, setView] = useState<"list" | "json">("list");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(true);
	const [toolName, setToolName] = useState("");
	const [tier, setTier] = useState<McpRiskTier>("reversible");
	const [editor, setEditor] = useState<{ originalName?: string; name: string; json: string } | null>(null);
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
		try { const next = await action(); setState(next); setJson(next.json); return true; }
		catch (reason) { setError(String(reason)); }
		finally { setBusy(false); }
		return false;
	}
	const editServer = (name: string) => {
		try { setEditor({ originalName: name, name, json: JSON.stringify(JSON.parse(state!.json).mcpServers[name], null, 2) }); setError(""); }
		catch (error) { setError(String(error)); }
	};
	return <>
		<div className="mb-4 flex items-center justify-between gap-2">
			<Segmented value={view} onChange={value => { if (!editor) setView(value); }} options={[{ value: "list", label: "列表" }, { value: "json", label: "JSON" }]} />
			<div className="flex gap-2"><Button disabled={busy || dirty || editor !== null} onClick={() => void change(() => window.rally.mcp.getState())}><RefreshCw size={13} />刷新</Button><Button variant="primary" disabled={busy || dirty || editor !== null} onClick={() => { setView("list"); setError(""); setEditor({ name: "", json: '{\n  "command": "",\n  "args": []\n}' }); }}><Plus size={13} />添加服务器</Button></div>
		</div>
		<p className="mb-4 text-xs leading-relaxed text-muted">之后启动或续接的任务使用这里的配置，当前任务保持原设置。搜索披露让任务先用 tool_search 查找所需工具，再加载并调用；主对话只获得能力摘要，由任务使用 MCP。</p>
		{error && <p role="alert" className="mb-4 break-words text-xs text-red-500">{error}</p>}
		{state?.errors.map((message) => <p key={message} role="alert" className="mb-2 break-all text-xs text-red-500">{message}</p>)}
		{dirty && <p className="mb-3 text-xs text-muted">JSON 有未保存修改，请保存后再修改列表。</p>}
		{editor && <fieldset disabled={busy} className="mb-4 rounded-2xl bg-sunken p-4">
			<div className="mb-3 text-sm font-medium">{editor.originalName === undefined ? "添加服务器" : `编辑 ${editor.originalName}`}</div>
			<label className="text-xs text-muted">服务器名称<input aria-label="服务器名称" value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} className="my-2 block w-full rounded-lg bg-panel px-3 py-2 text-sm" /></label>
			<p className="mb-2 text-xs leading-relaxed text-muted">填写单个服务器的 JSON 配置：stdio 使用 command、args，HTTP 使用 url；可选 description 简述用途。</p>
			<textarea aria-label="单个 MCP 服务器配置" spellCheck={false} value={editor.json} onChange={event => setEditor({ ...editor, json: event.target.value })} className="selectable min-h-56 w-full rounded-xl bg-term p-3 font-mono text-xs leading-relaxed" />
			<div className="mt-3 flex justify-end gap-2"><Button onClick={() => { setEditor(null); setError(""); }}>取消</Button><Button variant="primary" disabled={!editor.name.trim()} onClick={async () => { if (await change(() => window.rally.mcp.saveServer(editor.name.trim(), editor.json, editor.originalName))) setEditor(null); }}>保存服务器</Button></div>
		</fieldset>}
		{view === "json" ? <>
			<p className="mb-2 text-xs text-faint">在 mcpServers 中按名称添加服务器。stdio 使用 command 与 args 数组，HTTP 使用 url；可保留 env、headers 和其他 Pi 支持的字段。</p>
			<textarea aria-label="MCP JSON 配置" spellCheck={false} disabled={busy} className="selectable min-h-80 w-full rounded-2xl bg-term p-4 font-mono text-xs leading-relaxed text-fg/85 outline-none" value={json} onChange={(event) => setJson(event.target.value)} />
			<div className="mt-3 flex justify-end"><Button variant="primary" disabled={busy || !dirty} onClick={() => void change(() => window.rally.mcp.save(json))}>保存配置</Button></div>
		</> : <fieldset disabled={busy || dirty || editor !== null} className="flex min-w-0 flex-col gap-1 rounded-2xl bg-sunken p-1">
			{state?.servers.map((server) => <ServerSettings key={server.name} server={server} change={change} edit={() => editServer(server.name)} />)}
			{state?.servers.length === 0 && <p className="p-4 text-xs text-faint">尚未配置 MCP 服务器</p>}
		</fieldset>}
		<div className="mt-6 text-sm font-medium">工具风险档</div>
		<p className="mb-3 mt-1 text-xs leading-relaxed text-muted">列表来自任务曾发现的工具及已保存的设置，不表示当前在线。默认可逆；有对外代价的调用会执行并提示、留审计；不可逆调用会等待确认。保存后从下一次调用起生效，已经发出的确认仍需处理。</p>
		<fieldset disabled={busy || dirty || editor !== null} className="space-y-2">
			{state?.tools.map((tool) => <div key={tool.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3 py-2">
				<span className="min-w-0 break-all font-mono text-xs text-muted">{tool.name}</span>
				<select aria-label={`${tool.name} 风险档`} value={tool.tier} onChange={(event) => void change(() => window.rally.mcp.setTier(tool.name, event.target.value as McpRiskTier))} className="rounded-md bg-panel px-2 py-1 text-xs"><RiskOptions /></select>
			</div>)}
			<div className="flex flex-wrap gap-2"><input aria-label="MCP 工具完整名称" placeholder="mcp__server__tool" value={toolName} onChange={(event) => setToolName(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-sunken px-3 py-2 font-mono text-xs outline-none" /><select aria-label="新工具风险档" value={tier} onChange={(event) => setTier(event.target.value as McpRiskTier)} className="rounded-lg bg-sunken px-2 py-1 text-xs"><RiskOptions /></select><Button disabled={!toolName.trim()} onClick={() => void change(() => window.rally.mcp.setTier(toolName.trim(), tier))}>保存风险档</Button></div>
		</fieldset>
	</>;
}

const EXPOSURE_LABELS: Record<McpExposure, string> = { direct: "直接披露", deferred: "搜索披露", codemode: "代码模式", hidden: "隐藏" };

function ExposureOptions() {
	return <>{Object.entries(EXPOSURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>;
}

function ServerSettings({ server, change, edit }: { server: McpServerSettings; change(action: () => Promise<McpConfigurationState>): Promise<unknown>; edit(): void }) {
	const [pattern, setPattern] = useState("");
	const [exposure, setExposure] = useState<McpExposure>("deferred");
	const rules = Object.entries(server.toolExposure);
	const set = (mode: McpExposure | null, tool?: string) => change(() => window.rally.mcp.setExposure(server.name, mode, tool));
	return <div className="min-w-0 rounded-xl bg-panel px-4 py-3 dark:bg-raised/60">
		<div className="flex items-center gap-4">
			<Plug size={16} className="shrink-0 text-faint" />
			<div className="min-w-0 flex-1"><div className="text-sm font-medium">{server.name} <span className="text-[10px] uppercase text-faint">{server.transport}</span></div><div className="mt-1 truncate font-mono text-xs text-faint" title={server.address}>{server.address}</div></div>
			<button aria-label={`编辑 ${server.name}`} title={`编辑 ${server.name}`} onClick={edit} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg"><Pencil size={14} /></button>
			<button aria-label={`删除 ${server.name}`} onClick={() => void change(() => window.rally.mcp.update(server.name, null))} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
			<Toggle label={`启用 ${server.name}`} checked={server.enabled} onChange={enabled => void change(() => window.rally.mcp.update(server.name, enabled))} />
		</div>
		<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
			<span className="text-xs text-muted">默认工具披露</span>
			<select aria-label={`${server.name} 默认工具披露`} value={server.exposure} onChange={event => void set(event.target.value as McpExposure)} className="rounded-md bg-sunken px-2 py-1 text-xs"><ExposureOptions /></select>
		</div>
		<details className="mt-3 text-xs">
			<summary className="cursor-pointer text-muted">单个工具或匹配规则{rules.length ? `（${rules.length}）` : ""}</summary>
			<p className="my-2 leading-relaxed text-faint">填写服务器原始工具名，如 search_issues；可用 * 匹配多个工具。精确名称优先，其次按列表顺序取首条匹配规则；删除规则后使用其余匹配规则或服务器默认值。</p>
			<div className="space-y-2">
				{rules.map(([tool, mode]) => <div key={tool} className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken px-2.5 py-2">
					<span className="min-w-0 flex-1 break-all font-mono">{tool}</span>
					<select aria-label={`${server.name}/${tool} 工具披露`} value={mode} onChange={event => void set(event.target.value as McpExposure, tool)} className="rounded-md bg-panel px-2 py-1"><ExposureOptions /></select>
					<button aria-label={`删除 ${server.name}/${tool} 披露规则`} onClick={() => void set(null, tool)} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg"><Trash2 size={13} /></button>
				</div>)}
				<div className="flex flex-wrap gap-2">
					<input aria-label={`${server.name} 原始工具名或匹配规则`} placeholder="search_issues 或 search_*" value={pattern} onChange={event => setPattern(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-sunken px-3 py-2 font-mono outline-none" />
					<select aria-label={`${server.name} 新规则披露方式`} value={exposure} onChange={event => setExposure(event.target.value as McpExposure)} className="rounded-lg bg-sunken px-2 py-1"><ExposureOptions /></select>
					<Button disabled={!pattern.trim()} onClick={() => void set(exposure, pattern.trim())}>保存规则</Button>
				</div>
			</div>
		</details>
	</div>;
}

function RiskOptions() {
	return <><option value="reversible">可逆</option><option value="external">有对外代价</option><option value="irreversible">不可逆</option></>;
}
