import { useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, Info, Loader2, Plus, Trash2 } from "lucide-react";
import {
	type ModelEntry,
	type ProviderEntry,
	type ProviderProtocol,
	THINKING_LEVELS,
	type ThinkingLevelName,
	defaultModel,
} from "../../../shared/models";
import { useModels } from "../models";
import { uid, useApp } from "../store";
import { Button, Input, Segmented, Textarea, Toggle } from "./ui";
import { cn } from "../utils/cn";
import { ModelPicker } from "./ModelPicker";
import { DEFAULT_IDENTITY, IDENTITY_LIMITS, type IdentityText } from "../../../shared/identity";
import { AgentAvatar } from "./AgentAvatar";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function IdentityForm() {
  const { config, identityReady, identityError, reloadIdentity } = useApp();
  const [draft, setDraft] = useState<IdentityText>({ name: config.name, personality: config.personality, workstyle: config.workstyle });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft({ name: config.name, personality: config.personality, workstyle: config.workstyle }); }, [config.name, config.personality, config.workstyle]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true); setError(""); setSaved(false);
    try { const result = await run(); if (result !== null) setSaved(true); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const dirty = draft.name !== config.name || draft.personality !== config.personality || draft.workstyle !== config.workstyle;
  const loading = !identityReady && !identityError;
  return (
    <div>
    <div className="glass-strong divide-y divide-line overflow-hidden rounded-[24px]">
      <div className="identity-avatar-field grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4">
        <AgentAvatar size={56} />
        <div className="min-w-0"><div className="text-[14px] font-medium">头像</div><div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">PNG、JPEG 或 WebP，5 MiB 以内；居中裁成正方形</div></div>
        <div className="identity-avatar-actions col-span-2 flex flex-wrap gap-2"><Button size="sm" disabled={!identityReady || busy} onClick={() => void action(() => window.rally.identity.pickAvatar())}>选择图片</Button>{config.avatar && <Button size="sm" disabled={busy} onClick={() => void action(() => window.rally.identity.resetAvatar())}>恢复默认</Button>}</div>
      </div>
      {([
        { key: "name", label: "名称", hint: "会显示在名片与对话中", rows: 0 },
        { key: "personality", label: "性格", hint: "说话的语气与态度", rows: 2 },
        { key: "workstyle", label: "工作方式", hint: "规划、派发与确认的偏好", rows: 3 },
      ] as const).map(field => <label key={field.key} className="flex flex-col gap-4 px-5 py-4">
        <div><span className="text-[14px] font-medium">{field.label}</span><span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{field.hint}</span></div>
        {field.rows ? <Textarea disabled={loading || busy} maxLength={IDENTITY_LIMITS[field.key]} rows={field.rows} value={draft[field.key]} onChange={event => { setDraft(current => ({ ...current, [field.key]: event.target.value })); setSaved(false); }} /> : <Input disabled={loading || busy} maxLength={IDENTITY_LIMITS.name} value={draft.name} onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); setSaved(false); }} placeholder={DEFAULT_IDENTITY.name} />}
      </label>)}
    </div>
    <div className="mt-4 flex items-center justify-between gap-3 px-1"><p className="text-[12px] text-muted">保存后从主对话下一次模型请求生效。权限与审批规则保持有效。</p><Button variant="primary" disabled={loading || busy || (!dirty && !identityError) || !draft.name.trim()} onClick={() => void action(() => window.rally.identity.update(draft))}>{busy ? "保存中…" : "保存人设"}</Button></div>
    {(error || identityError) && <div role="alert" className="mt-3 text-xs text-danger">{error || identityError}{identityError && <Button size="sm" onClick={reloadIdentity}>重试加载</Button>}</div>}
    {saved && !dirty && <p role="status" className="mt-2 text-xs text-ok">{window.runtime.mode === "cloud" ? "已保存到服务器" : "已保存到本机"}</p>}
    </div>
  );
}

export { MemoryForm } from "./MemoryForm";

const PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
	{ value: "messages", label: "messages" },
	{ value: "responses", label: "Responses" },
];

const LEVEL_LABEL: Record<ThinkingLevelName, string> = {
	off: "关闭",
	minimal: "极低",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "很高",
	max: "最高",
};

function NumField({
	label,
	value,
	onChange,
	min,
	max,
	step,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
}) {
	return (
		<label className="block">
			<span className="mb-0.5 block text-[11px] text-faint">{label}</span>
			<Input
				type="number"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="h-7 bg-panel px-2 text-[12px] dark:bg-raised"
			/>
		</label>
	);
}

function ModelRow({
	model,
	onChange,
	onRemove,
}: {
	model: ModelEntry;
	onChange: (patch: Partial<ModelEntry>) => void;
	onRemove: () => void;
}) {
	const [open, setOpen] = useState(false);
	const toggleLevel = (level: ThinkingLevelName) => {
		const has = model.thinkingLevels.includes(level);
		onChange({ thinkingLevels: has ? model.thinkingLevels.filter((l) => l !== level) : [...model.thinkingLevels, level] });
	};
	return (
		<div className="rounded-lg bg-panel px-2.5 py-2 dark:bg-raised">
			<div className="flex items-center gap-2">
				<input
					value={model.id}
					onChange={(e) => onChange({ id: e.target.value })}
					placeholder="模型名"
					className="h-6 min-w-0 flex-1 rounded bg-transparent px-1 font-mono text-[12px] hover:bg-hover focus:bg-sunken"
				/>
				<button onClick={() => setOpen((v) => !v)} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg">
					{open ? "收起" : "元数据"}
				</button>
				<button onClick={onRemove} className="rounded p-1 text-faint hover:bg-red-500/10 hover:text-red-500">
					<Trash2 size={13} />
				</button>
			</div>
			{!open && (
				<div className="mt-1 px-1 text-[11px] text-faint">
					{model.contextWindow} ctx · {model.maxTokens} 输出 · 压缩 {model.compactionThreshold}
					{model.vision ? " · 视觉" : ""}
					{model.reasoning ? " · 思考" : ""}
				</div>
			)}
			{open && (
				<div className="mt-2 grid grid-cols-3 gap-2">
					<NumField label="上下文长度" value={model.contextWindow} min={1} onChange={(v) => onChange({ contextWindow: v })} />
					<NumField label="压缩阈值（0-1）" value={model.compactionThreshold} min={0} max={1} step={0.05} onChange={(v) => onChange({ compactionThreshold: v })} />
					<NumField label="最大输出" value={model.maxTokens} min={1} onChange={(v) => onChange({ maxTokens: v })} />
					<div className="flex items-center justify-between rounded-lg bg-panel px-2 py-1 text-[11px] text-muted dark:bg-raised">
						<span>支持视觉</span>
						<Toggle checked={model.vision} onChange={(v) => onChange({ vision: v })} />
					</div>
					<div className="flex items-center justify-between rounded-lg bg-panel px-2 py-1 text-[11px] text-muted dark:bg-raised">
						<span>支持思考</span>
						<Toggle checked={model.reasoning} onChange={(v) => onChange({ reasoning: v })} />
					</div>
					<div className="col-span-3">
						{model.reasoning ? (
							<div className="flex flex-wrap items-center gap-1">
								<span className="mr-1 text-[11px] text-faint">档位</span>
								{THINKING_LEVELS.filter((level) => level !== "off").map((level) => (
									<button
										key={level}
										onClick={() => toggleLevel(level)}
										className={cn(
											"h-6 rounded-md px-2 text-[11px] transition-colors",
											model.thinkingLevels.includes(level) ? "bg-accent-soft text-accent" : "bg-panel text-muted hover:text-fg dark:bg-raised",
										)}
									>
										{LEVEL_LABEL[level]}
									</button>
								))}
								<span className="text-[11px] text-faint">不选 = Pi 默认档位</span>
							</div>
						) : (
							<span className="text-[11px] text-faint">该模型未声明思考能力，选择器中不会出现思考档位。</span>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function ProviderCard({
	provider,
	onChange,
	onRemove,
}: {
	provider: ProviderEntry;
	onChange: (patch: Partial<ProviderEntry>) => void;
	onRemove: () => void;
}) {
	const { fetchModels } = useModels();
	const [show, setShow] = useState(false);
	const [loading, setLoading] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const [manual, setManual] = useState("");

	const pull = async () => {
		if (!provider.baseUrl.trim()) {
			setNote("请先填写 Base URL");
			return;
		}
		setLoading(true);
		setNote(null);
		let result;
		try { result = await fetchModels({ protocol: provider.protocol, baseUrl: provider.baseUrl, apiKey: provider.apiKey }); }
		catch (error) { setNote(String(error)); return; }
		finally { setLoading(false); }
		if (!result.ok) {
			setNote(`拉取失败：${result.error}。可在下方手工填写模型名。`);
			return;
		}
		const existing = new Set(provider.models.map((m) => m.id));
		const added = result.models.filter((id) => !existing.has(id)).map(defaultModel);
		onChange({ models: [...provider.models, ...added] });
		setNote(added.length ? `接口返回 ${result.models.length} 个模型，新增 ${added.length} 个` : `接口返回 ${result.models.length} 个模型，均已存在`);
	};

	const addManual = () => {
		const id = manual.trim();
		if (!id) return;
		if (provider.models.some((m) => m.id === id)) {
			setNote(`模型 ${id} 已在列表中`);
			return;
		}
		onChange({ models: [...provider.models, defaultModel(id)] });
		setManual("");
		setNote(null);
	};

	return (
		<div className="glass-strong animate-rise rounded-[24px] p-5">
			<div className="flex items-center gap-2">
				<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-sm font-semibold text-muted shadow-soft">
					{(provider.name || "?")[0]}
				</div>
				<input
					value={provider.name}
					onChange={(e) => onChange({ name: e.target.value })}
					placeholder="供应商名称（选择器里的浅色小字）"
					className="h-8 flex-1 rounded-md bg-transparent px-1.5 text-sm font-medium hover:bg-hover focus:bg-panel"
				/>
				<button onClick={onRemove} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500">
					<Trash2 size={14} />
				</button>
			</div>
			<div className="mt-2 flex items-center gap-2">
				<span className="text-[11px] text-faint">协议</span>
				<Segmented value={provider.protocol} options={PROTOCOLS} onChange={(protocol) => onChange({ protocol })} />
			</div>
			<div className="mt-2 grid gap-2">
				<Input
					className="bg-panel font-mono text-[12.5px] dark:bg-raised"
					placeholder="Base URL，例如 https://api.anthropic.com"
					value={provider.baseUrl}
					onChange={(e) => onChange({ baseUrl: e.target.value })}
				/>
				<div className="relative">
					<Input
						className="bg-panel pr-9 font-mono text-[12.5px] dark:bg-raised"
						type={show ? "text" : "password"}
						placeholder={provider.apiKey.startsWith("已保存:") ? "密钥已保存在服务器；输入以替换" : "API Key（本地服务可留空）"}
						value={provider.apiKey.startsWith("已保存:") ? "" : provider.apiKey}
						onChange={(e) => onChange({ apiKey: e.target.value })}
					/>
					<button onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg">
						{show ? <EyeOff size={14} /> : <Eye size={14} />}
					</button>
				</div>
				{provider.apiKey.startsWith("已保存:") && <button className="text-right text-xs text-muted" onClick={() => onChange({ apiKey: "" })}>清除已保存密钥</button>}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={() => void pull()} className="bg-panel shadow-soft dark:bg-raised">
					{loading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}拉取模型
				</Button>
				<div className="flex flex-1 items-center gap-1.5">
					<Input
						value={manual}
						onChange={(e) => setManual(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") addManual();
						}}
						placeholder="拉取失败时手工填写模型名"
						className="h-7 bg-panel font-mono text-[12px] dark:bg-raised"
					/>
					<Button size="sm" onClick={addManual} className="bg-panel shadow-soft dark:bg-raised">
						<Plus size={12} />添加
					</Button>
				</div>
			</div>
			{note && <div className="mt-2 text-[11px] text-faint">{note}</div>}
			{provider.models.length > 0 && (
				<div className="mt-3 flex flex-col gap-1.5">
					{provider.models.map((model, index) => (
						<ModelRow
							key={index}
							model={model}
							onChange={(patch) => onChange({ models: provider.models.map((m, i) => (i === index ? { ...m, ...patch } : m)) })}
							onRemove={() => onChange({ models: provider.models.filter((_, i) => i !== index) })}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function ProvidersForm() {
	const { state, save, select, selectWorker, reload } = useModels();
	const [draft, setDraft] = useState<ProviderEntry[]>(state?.providers ?? []);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const dirtyRef = useRef(false);
	const revision = useRef(state?.revision);

	useEffect(() => {
		// Don't overwrite in-progress edits when another window saves.
		if (!dirtyRef.current && state) { setDraft(state.providers); revision.current = state.revision; }
	}, [state]);

	const edit = (next: ProviderEntry[]) => {
		dirtyRef.current = true;
		setDirty(true);
		setDraft(next);
	};
	const update = (id: string, patch: Partial<ProviderEntry>) => edit(draft.map((p) => (p.id === id ? { ...p, ...patch } : p)));

	const commit = async () => {
		setSaving(true);
		setMessage(null);
		try {
			const result = await save(draft, revision.current);
			revision.current = result.revision;
			dirtyRef.current = false;
			setDirty(false);
			setDraft(result.providers);
			setMessage(result.errors.length ? `已保存；${result.errors.length} 条问题：${result.errors.join("；")}` : "已保存");
		} catch (error) {
			setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setSaving(false);
		}
	};

	const errors = state?.errors ?? [];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2 rounded-xl bg-sunken px-3 py-2">
				<span className="min-w-0 break-all text-[11px] text-faint">
					配置文件 <span className="font-mono text-muted">{state?.file ?? "~/.rally/agent/rally-models.json"}</span>
				</span>
				<div className="flex-1" />
				{dirty && <span className="text-[11px] text-amber-600">未保存</span>}
				{window.runtime.mode === "cloud" && <Button size="sm" disabled={saving} onClick={() => { if (dirty) { setMessage("有未保存修改，点击「放弃修改并刷新」后重新编辑。"); return; } void reload().catch(error => setMessage(String(error))); }}>刷新</Button>}
				<Button size="sm" variant="primary" onClick={() => void commit()} disabled={saving}>
					{saving && <Loader2 size={13} className="animate-spin" />}保存配置
				</Button>
			</div>
			{message && <div className="px-1 text-[11px] text-muted">{message}</div>}
			{dirty && window.runtime.mode === "cloud" && <p className="text-xs text-muted">{state?.revision !== revision.current ? "服务器配置已更新。" : "当前修改仅在保存后生效。"}<button className="ml-2 text-accent" onClick={() => { dirtyRef.current=false;setDirty(false);void reload().catch(error=>setMessage(String(error))); }}>放弃修改并刷新</button></p>}
			{errors.length > 0 && (
				<div className="flex gap-2 rounded-xl bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-red-500">
					<Info size={13} className="mt-0.5 shrink-0" />
					<div>{errors.join("；")}</div>
				</div>
			)}
			<div className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3.5 py-3">
				<div className="text-xs font-medium text-fg">主 agent 模型</div>
				<ModelPicker direction="down" models={state?.available ?? []} model={state?.active ? `${state.active.provider}/${state.active.model}` : null} thinkingLevel={state?.active?.thinkingLevel ?? null}
					onSelect={(provider, model, thinkingLevel) => void select({ provider, model, thinkingLevel }).catch((error: unknown) => setMessage(`选择失败：${error instanceof Error ? error.message : String(error)}`))} />
			</div>
			<div className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3.5 py-3">
				<div className="text-xs text-muted">
					<div className="font-medium text-fg">任务 agent 模型</div>
					<div className="mt-1 text-[11px] text-faint">保存供应商后选择；用于之后启动和续接的任务。主 agent 模型在对话框底部选择。</div>
				</div>
				<ModelPicker direction="down" models={state?.available ?? []} model={state?.worker ? `${state.worker.provider}/${state.worker.model}` : null} thinkingLevel={state?.worker?.thinkingLevel ?? null}
					onSelect={(provider, model, thinkingLevel) => void selectWorker({ provider, model, thinkingLevel }).catch((error: unknown) => setMessage(`选择失败：${error instanceof Error ? error.message : String(error)}`))} />
			</div>
			{draft.map((provider) => (
				<ProviderCard
					key={provider.id}
					provider={provider}
					onChange={(patch) => update(provider.id, patch)}
					onRemove={() => edit(draft.filter((p) => p.id !== provider.id))}
				/>
			))}
			<button
				onClick={() =>
					edit([
						...draft,
						{ id: `rp_${uid()}`, name: "", protocol: "messages", baseUrl: "", apiKey: "", models: [] },
					])
				}
				className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-sunken text-sm text-muted transition-all hover:bg-deep hover:text-fg dark:hover:bg-raised"
			>
				<Plus size={15} />
				添加供应商
			</button>
			<div className="flex gap-2.5 rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-muted">
				<Info size={14} className="mt-0.5 shrink-0 text-faint" />
				<div>
					配置按明文 JSON 保存在上面这个路径，不与 Pi 自身的 models.json 冲突。协议只有两种：messages（Anthropic Messages）与
					Responses（OpenAI Responses），实际请求由 Pi 实现。
				</div>
			</div>
		</div>
	);
}
