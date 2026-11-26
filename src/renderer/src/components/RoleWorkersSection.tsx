import { Checkbox, Disclosure } from "../md3/interactive";
import { ChoiceSelect } from "../md3/Select";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Pencil, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { ExternalAgentModel, RoleWorkerDraft, RoleWorkerExecutor, RoleWorkerProfile } from "../../../shared/role-workers";
import type { SkillsState } from "../../../shared/skills";
import { useModels } from "../models";
import { Button, Input, Textarea } from "./ui";

const emptyDraft = (): RoleWorkerDraft => ({ id: crypto.randomUUID(), name: "", avatar: null, summary: "", personality: "", workstyle: "", recommendedSkills: [] });

async function imageAvatar(file: File): Promise<string> {
	if (file.size > 5 * 1024 * 1024) throw new Error("图片不能超过 5 MiB");
	const image = await createImageBitmap(file);
	try {
		const edge = Math.min(image.width, image.height);
		const canvas = document.createElement("canvas");
		canvas.width = 256;
		canvas.height = 256;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("无法处理这张图片");
		context.drawImage(image, Math.floor((image.width - edge) / 2), Math.floor((image.height - edge) / 2), edge, edge, 0, 0, 256, 256);
		return canvas.toDataURL("image/png");
	} finally { image.close(); }
}

function Avatar({ name, image, size = 44 }: { name: string; image: string | null; size?: number }) {
	return image
		? <img src={image} alt="" width={size} height={size} className="shrink-0 rounded-2xl object-cover" />
		: <div style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-2xl bg-accent/12 font-display text-lg font-semibold text-accent">{name.trim().slice(0, 1) || "?"}</div>;
}

export function RoleWorkersSection() {
	const { state: models } = useModels();
	const [roles, setRoles] = useState<RoleWorkerProfile[]>([]);
	const [skills, setSkills] = useState<SkillsState>();
	const [draft, setDraft] = useState<RoleWorkerDraft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [externalModels, setExternalModels] = useState<ExternalAgentModel[]>([]);
	const [loadingExternalModels, setLoadingExternalModels] = useState(false);
	const modelRequest = useRef(0);

	const refresh = async () => {
		const [nextRoles, nextSkills] = await Promise.all([window.rally.roleWorkers.getState(), window.rally.skills.getState()]);
		setRoles(nextRoles);
		setSkills(nextSkills);
	};
	useEffect(() => {
		let alive = true;
		const load = async () => {
			try {
				const [nextRoles, nextSkills] = await Promise.all([window.rally.roleWorkers.getState(), window.rally.skills.getState()]);
				if (alive) { setRoles(nextRoles); setSkills(nextSkills); setError(""); }
			} catch (reason) { if (alive) setError(String(reason)); }
		};
		void load();
		const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === "role-workers") void load(); };
		const focused = () => void load();
		window.addEventListener("rally-configuration", changed);
		window.addEventListener("focus", focused);
		return () => { alive = false; window.removeEventListener("rally-configuration", changed); window.removeEventListener("focus", focused); };
	}, []);

	const edit = (role: RoleWorkerProfile) => {
		modelRequest.current++;
		setExternalModels([]);
		setLoadingExternalModels(false);
		setDraft({ id: role.id, name: role.name, avatar: role.avatar, summary: role.summary, personality: role.personality, workstyle: role.workstyle, ...(role.model ? { model: role.model } : {}), ...(role.executor ? { executor: role.executor, externalModel: role.externalModel } : {}), recommendedSkills: [...role.recommendedSkills] });
		setError(""); setNotice("");
	};
	const update = <K extends keyof RoleWorkerDraft>(key: K, value: RoleWorkerDraft[K]) => setDraft(current => current ? { ...current, [key]: value } : current);
	const loadExternalModels = async (executor: Exclude<RoleWorkerExecutor, "rally">) => {
		const request = ++modelRequest.current;
		setLoadingExternalModels(true);
		setError("");
		try {
			const next = await window.rally.roleWorkers.getAgentModels(executor);
			if (request === modelRequest.current) setExternalModels(next);
		} catch (reason) {
			if (request === modelRequest.current) { setExternalModels([]); setError(String(reason)); }
		} finally {
			if (request === modelRequest.current) setLoadingExternalModels(false);
		}
	};
	const chooseExecutor = (executor: RoleWorkerExecutor) => {
		setDraft(current => current ? { ...current, executor, model: undefined, externalModel: undefined } : current);
		modelRequest.current++;
		setExternalModels([]);
		setLoadingExternalModels(false);
		setError("");
		if (executor !== "rally") void loadExternalModels(executor);
	};
	const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		try { update("avatar", await imageAvatar(file)); setError(""); }
		catch (reason) { setError(String(reason)); }
	};
	const save = async () => {
		if (!draft) return;
		setBusy(true); setError(""); setNotice("");
		try {
			const model = draft.model;
			const saved = await window.rally.roleWorkers.save({ ...draft, ...(model ? { model } : {}), ...(draft.executor && draft.executor !== "rally" && draft.externalModel ? { externalModel: draft.externalModel } : {}) });
			setRoles(saved); setDraft(null); setNotice("角色已保存");
		} catch (reason) { setError(String(reason)); }
		finally { setBusy(false); }
	};
	const remove = async (id: string) => {
		setBusy(true); setError(""); setNotice("");
		try { setRoles(await window.rally.roleWorkers.delete(id)); if (draft?.id === id) setDraft(null); setNotice("角色已删除"); }
		catch (reason) { setError(String(reason)); }
		finally { setBusy(false); }
	};
	const availableSkills = skills?.skills ?? [];
	const selectedModel = draft?.executor && draft.executor !== "rally" ? draft.externalModel ?? "" : draft?.model ? `${draft.model.provider}/${draft.model.model}` : "";

	return <div className="space-y-5">
		<div className="glass-strong rounded-[24px] p-5">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div><h2 className="text-sm font-semibold">角色 Workers</h2><p className="mt-1 text-xs leading-relaxed text-muted">给任务 worker 保存可复用的人设和工作习惯；最终派工仍由主 agent 决定。</p></div>
				{!draft && <Button size="sm" variant="primary" onClick={() => { setDraft(emptyDraft()); setError(""); setNotice(""); }}><Plus size={14} />新建角色</Button>}
			</div>
			<p className="rounded-2xl bg-sunken px-4 py-3 text-xs leading-relaxed text-muted">角色不会增加权限，也不能创建子 agent。Skills 是可忽略的推荐；原生角色沿用普通 worker 的 MCP 和工具；实验性执行器使用自己的工具和权限。</p>
			{!roles.length && !draft && <p className="py-8 text-center text-sm text-faint">还没有角色。可以先创建一个后端、测试或设计方向的 worker。</p>}
			{roles.length > 0 && <div className="mt-4 space-y-2">{roles.map(role => <div key={role.id} className="flex items-center gap-3 rounded-2xl bg-sunken p-3">
				<Avatar name={role.name} image={role.avatar} />
				<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{role.name}</div><div className="line-clamp-2 text-xs leading-relaxed text-muted">{role.summary || "暂无摘要"}</div></div>
				<Button size="sm" variant="ghost" disabled={busy} aria-label={`编辑 ${role.name}`} onClick={() => edit(role)}><Pencil size={14} /></Button>
				<Button size="sm" variant="ghost" disabled={busy} aria-label={`删除 ${role.name}`} onClick={() => void remove(role.id)}><Trash2 size={14} /></Button>
			</div>)}</div>}
		</div>

		{draft && <div className="glass-strong rounded-[24px] p-5">
			<div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-semibold">{roles.some(role => role.id === draft.id) ? "编辑角色" : "新建角色"}</h2><Button size="sm" variant="ghost" aria-label="取消编辑" onClick={() => setDraft(null)}><X size={15} /></Button></div>
			<div className="space-y-4">
				<div className="flex items-center gap-4"><Avatar name={draft.name} image={draft.avatar} size={56} /><div className="flex flex-wrap gap-2"><label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-sunken px-3 text-xs font-medium hover:bg-deep"><Upload size={13} />选择头像<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => void chooseAvatar(event)} /></label>{draft.avatar && <Button size="sm" variant="ghost" onClick={() => update("avatar", null)}>移除头像</Button>}<p className="w-full text-[11px] text-faint">PNG、JPEG 或 WebP；居中裁切为 256×256 PNG</p></div></div>
				<label className="block"><span className="mb-1.5 block text-xs font-medium">名称</span><Input maxLength={40} value={draft.name} onChange={event => update("name", event.target.value)} placeholder="例如：小柏 · 后端工程师" /></label>
				<label className="block"><span className="mb-1.5 block text-xs font-medium">摘要 <span className="font-normal text-faint">（主 agent 用来判断何时派遣）</span></span><Textarea rows={2} maxLength={500} value={draft.summary} onChange={event => update("summary", event.target.value)} placeholder="擅长的领域、常接的任务类型" /></label>
				<label className="block"><span className="mb-1.5 block text-xs font-medium">人设</span><Textarea rows={3} maxLength={4000} value={draft.personality} onChange={event => update("personality", event.target.value)} placeholder="专业背景、优先原则、表达风格" /></label>
				<label className="block"><span className="mb-1.5 block text-xs font-medium">工作规范</span><Textarea rows={3} maxLength={4000} value={draft.workstyle} onChange={event => update("workstyle", event.target.value)} placeholder="检查步骤、质量标准、交付格式" /></label>
				{(!draft.executor || draft.executor === "rally") && <label className="block">
					<span className="mb-1.5 block text-xs font-medium">Rally 模型</span>
					<ChoiceSelect className="h-10 w-full rounded-xl bg-deep px-3.5 text-sm text-fg focus:bg-md-surface-highest" value={selectedModel} onValueChange={choiceValue => {
						const model = models?.available.find(item => `${item.provider}/${item.id}` === choiceValue);
						update("model", model ? { provider: model.provider, model: model.id } : undefined);
					}}>
						<option value="">沿用默认任务模型</option>
						{models?.available.map(model => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.providerName} · {model.name}</option>)}
					</ChoiceSelect>
				</label>}
				<Disclosure key={draft.id} className="rounded-2xl bg-sunken p-3">
					<summary className="cursor-pointer text-xs font-medium">实验性功能</summary>
					<div className="mt-3 space-y-3">
						<label className="block">
							<span className="mb-1.5 block text-xs font-medium">Worker 执行器</span>
							<ChoiceSelect className="h-10 w-full rounded-xl bg-deep px-3.5 text-sm text-fg focus:bg-md-surface-highest" value={draft.executor ?? "rally"} onValueChange={choiceValue => chooseExecutor(choiceValue as RoleWorkerExecutor)}>
								<option value="rally">Rally 原生 Worker</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option>
							</ChoiceSelect>
						</label>
						{draft.executor && draft.executor !== "rally" && <div>
							<div className="mb-1.5 text-xs font-medium">{draft.executor === "claude-code" ? "Claude Code 模型" : "Codex 模型"}</div>
							<div className="flex gap-2">
								<ChoiceSelect aria-label="外部模型" className="h-10 min-w-0 flex-1 rounded-xl bg-deep px-3.5 text-sm text-fg focus:bg-md-surface-highest" value={selectedModel} onValueChange={choiceValue => update("externalModel", choiceValue || undefined)}>
									<option value="">选择外部模型</option>
									{selectedModel && !externalModels.some(model => model.id === selectedModel) && <option value={selectedModel}>{selectedModel}（已保存）</option>}
									{externalModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
								</ChoiceSelect>
								<Button disabled={loadingExternalModels} onClick={() => {
									if (draft.executor && draft.executor !== "rally") void loadExternalModels(draft.executor);
								}}>{loadingExternalModels ? "读取中…" : "刷新"}</Button>
							</div>
							<p className="mt-1.5 text-[11px] leading-relaxed text-faint">按需安装，也可让 Rally 连接任务运行主机上已有的 Claude Code / Codex，复用其登录和模型配置。可在主对话中提出配置要求，完成后点击刷新。外部执行器暂不提供 Rally 浏览器、MCP 或工具审批。</p>
						</div>}
					</div>
				</Disclosure>
				<div><div className="mb-2 text-xs font-medium">推荐 Skills <span className="font-normal text-faint">（只提示优先参考，不限制使用）</span></div>{availableSkills.length ? <div className="max-h-52 space-y-1 overflow-y-auto rounded-2xl bg-sunken p-2">{availableSkills.map(skill => <label key={skill.path} className="flex cursor-pointer items-start gap-2 rounded-xl px-2 py-1.5 hover:bg-hover"><Checkbox className="mt-0.5 accent-[var(--c-accent)]" checked={draft.recommendedSkills.includes(skill.name)} onChange={event => update("recommendedSkills", event.target.checked ? [...draft.recommendedSkills, skill.name] : draft.recommendedSkills.filter(name => name !== skill.name))} /><span className="min-w-0"><span className="block text-xs font-medium">{skill.name}</span><span className="block text-[11px] leading-relaxed text-muted">{skill.description}{!skill.enabled && " · 当前在全局设置中停用"}</span></span></label>)}</div> : <p className="rounded-2xl bg-sunken px-3 py-4 text-xs text-faint">当前没有发现可选 Skills；角色仍可正常使用。</p>}</div>
			</div>
			<div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-danger" role="alert">{error}</p><div className="ml-auto flex gap-2"><Button disabled={busy} onClick={() => { modelRequest.current++; setDraft(null); setError(""); }}>取消</Button><Button variant="primary" disabled={busy || !draft.name.trim() || ((draft.executor ?? "rally") !== "rally" && !draft.externalModel)} onClick={() => void save()}>{busy ? "保存中…" : "保存角色"}</Button></div></div>
		</div>}
		{notice && <p role="status" className="px-2 text-xs text-ok"><Sparkles size={13} className="mr-1 inline" />{notice}</p>}
		{error && !draft && <p role="alert" className="px-2 text-xs text-danger">{error}</p>}
	</div>;
}
