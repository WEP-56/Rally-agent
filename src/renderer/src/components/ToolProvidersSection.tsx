import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { SEARCH_PROVIDERS, type ImageProvider, type ImageSelection, type SearchProviderId, type ToolProviderState } from "../../../shared/tool-providers";
import { Field } from "./forms";
import { Button, Input, Textarea, Toggle } from "./ui";

type ImageDraft = Omit<ImageProvider, "models"> & { models: string; apiKey: string };
interface Draft {
  images: ImageDraft[];
  search: { id: SearchProviderId; apiKey: string }[];
  preferredImage: ImageSelection | null;
  preferredSearch: SearchProviderId | null;
}

const searchIds = Object.keys(SEARCH_PROVIDERS) as SearchProviderId[];
const selectClass = "h-10 w-full rounded-xl bg-sunken px-3 text-sm text-fg ring-1 ring-inset ring-line focus:ring-accent";
const modelIds = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean);
const imageValue = (selection: ImageSelection | null) => selection ? JSON.stringify([selection.providerId, selection.model]) : "";
const draftFrom = (state: ToolProviderState): Draft => ({
  images: state.images.map(image => ({ ...image, models: image.models.join("\n"), apiKey: "" })),
  search: state.search.map(id => ({ id, apiKey: "" })),
  preferredImage: state.preferredImage,
  preferredSearch: state.preferredSearch,
});

function ProviderGroup({ title, note, action, children }: { title: string; note: string; action?: ReactNode; children: ReactNode }) {
  return <section className="mb-6">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
      <h2 className="text-[12px] font-semibold tracking-[0.12em] text-fg/45">{title}</h2>
      {action}
    </div>
    <div className="glass-strong divide-y divide-line overflow-hidden rounded-[24px]">
      <p className="px-5 py-4 text-[12.5px] leading-relaxed text-muted">{note}</p>
      {children}
    </div>
  </section>;
}

export function ToolProvidersSection() {
  const [state, setState] = useState<ToolProviderState>();
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState<"load" | "save" | null>("load");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function apply(value: ToolProviderState) {
    setState(value);
    setDraft(draftFrom(value));
  }

  useEffect(() => {
    let active = true;
    void window.rally.toolProviders.getState().then(value => {
      if (active) apply(value);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "无法加载提供商配置");
    }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    setBusy("load"); setSaved(false); setError("");
    try { apply(await window.rally.toolProviders.getState()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载提供商配置"); }
    finally { setBusy(null); }
  }

  function edit(update: (value: Draft) => Draft) {
    setDraft(value => value && update(value));
    setSaved(false);
  }

  function editImage(id: string, patch: Partial<ImageDraft>) {
    edit(value => ({ ...value, images: value.images.map(image => image.id === id ? { ...image, ...patch } : image) }));
  }

  const dirty = !!(state && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(state)));
  const imageOptions = draft?.images.flatMap(image => [...new Set(modelIds(image.models))].map(model => ({
    providerId: image.id, model, name: image.name.trim() || "新提供商",
  }))) ?? [];
  const preferredImage = imageOptions.find(option => imageValue(option) === imageValue(draft?.preferredImage ?? null)) ??
    (imageOptions.length === 1 ? imageOptions[0] : null);
  const preferredSearch = draft?.search.some(entry => entry.id === draft.preferredSearch) ? draft.preferredSearch :
    draft?.search.length === 1 ? draft.search[0].id : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !draft || busy || (!dirty && !state.error)) return;
    if (draft.images.length && !preferredImage) { setError("请选择首选生图模型"); return; }
    if (draft.search.length && !preferredSearch) { setError("请选择首选搜索提供商"); return; }
    setBusy("save"); setSaved(false); setError("");
    try {
      apply(await window.rally.toolProviders.save({
        revision: state.revision,
        images: draft.images.map(({ models, apiKey, ...image }) => ({ ...image, models: modelIds(models), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })),
        search: draft.search.map(({ id, apiKey }) => ({ id, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })),
        preferredImage: preferredImage && { providerId: preferredImage.providerId, model: preferredImage.model },
        preferredSearch,
      }));
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法保存提供商配置"); }
    finally { setBusy(null); }
  }

  if (!state || !draft) return <div className="glass-strong rounded-[24px] px-5 py-4 text-sm text-muted">
    {error ? <><p role="alert" className="mb-3 text-danger">{error}</p><Button size="sm" disabled={!!busy} onClick={() => void refresh()}>重试加载</Button></> : <p role="status">正在加载提供商配置…</p>}
  </div>;

  return <form onSubmit={event => void save(event)} autoComplete="off" aria-busy={!!busy}>
    <fieldset disabled={!!busy} className="min-w-0">
      <ProviderGroup title="图像生成" note="填写兼容 OpenAI 图像生成接口的 API 基础地址和模型 ID。image_gen 使用首选模型，生成的图片可预览、下载。" action={
        <Button size="sm" type="button" disabled={draft.images.length >= 16} onClick={() => edit(value => ({ ...value, images: [...value.images, { id: crypto.randomUUID(), name: "", baseUrl: "", models: "", apiKey: "" }] }))}><Plus size={14} />添加提供商</Button>
      }>
        {draft.images.length === 0 && <p className="px-5 py-4 text-sm text-faint">尚未配置图像提供商</p>}
        {draft.images.map((image, index) => {
          const existing = state.images.find(value => value.id === image.id);
          const needsKey = !existing || existing.baseUrl !== image.baseUrl.trim().replace(/\/+$/, "");
          return <div key={image.id} className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="min-w-0 truncate text-sm font-medium">{image.name || `图像提供商 ${index + 1}`}</h3>
              <Button size="sm" variant="ghost" type="button" aria-label={`移除${image.name || `图像提供商 ${index + 1}`}`} onClick={() => edit(value => ({
                ...value, images: value.images.filter(item => item.id !== image.id),
                preferredImage: value.preferredImage?.providerId === image.id ? null : value.preferredImage,
              }))}><Trash2 size={14} />移除</Button>
            </div>
            <Field label="提供商名称"><Input required maxLength={100} value={image.name} placeholder="例如：OpenAI" onChange={event => editImage(image.id, { name: event.target.value })} /></Field>
            <Field label="API 基础地址" hint="不含 /images/generations"><Input required type="url" maxLength={1000} spellCheck={false} value={image.baseUrl} placeholder="https://api.openai.com/v1" onChange={event => editImage(image.id, { baseUrl: event.target.value })} /></Field>
            <Field label="API Key"><Input required={needsKey} type="password" autoComplete="new-password" maxLength={4096} value={image.apiKey}
              placeholder={needsKey ? (existing ? "地址已修改，请重新填写" : "输入 API Key") : "已保存，留空保留"} onChange={event => editImage(image.id, { apiKey: event.target.value })} /></Field>
            <Field label="模型 ID" hint="每行一个，增删对应行即可"><Textarea required rows={3} maxLength={6432} spellCheck={false} value={image.models} placeholder="gpt-image-1" onChange={event => editImage(image.id, { models: event.target.value })} /></Field>
            <Field label="图片返回方式" hint="按提供商文档选择。返回内网图片链接时可选 Base64（若支持）。">
              <select className={selectClass} value={image.responseFormat ?? ""} onChange={event => {
                const value = event.target.value;
                editImage(image.id, { responseFormat: value === "b64_json" || value === "url" ? value : undefined });
              }}>
                <option value="">由提供商决定</option>
                <option value="b64_json">Base64 图片数据</option>
                <option value="url">图片链接</option>
              </select>
            </Field>
          </div>;
        })}
        {draft.images.length > 0 && <div className="px-5 py-4"><Field label="首选生图模型">
          <select className={selectClass} required value={imageValue(preferredImage)} onChange={event => {
            const match = imageOptions.find(option => imageValue(option) === event.target.value);
            edit(value => ({ ...value, preferredImage: match ? { providerId: match.providerId, model: match.model } : null }));
          }}>
            <option value="" disabled>选择模型</option>
            {imageOptions.map(option => <option key={imageValue(option)} value={imageValue(option)}>{option.name} · {option.model}</option>)}
          </select>
        </Field></div>}
      </ProviderGroup>

      <ProviderGroup title="网络搜索" note="可同时配置多家服务。web_search 使用首选提供商查找网页和摘要；读取网页正文时使用 fetch_page。">
        {searchIds.map(id => {
          const entry = draft.search.find(item => item.id === id);
          const existing = state.search.includes(id);
          return <div key={id} className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{SEARCH_PROVIDERS[id]}</h3>
              <Toggle label={`配置 ${SEARCH_PROVIDERS[id]}`} checked={!!entry} onChange={enabled => edit(value => ({
                ...value, search: enabled ? [...value.search, { id, apiKey: "" }] : value.search.filter(item => item.id !== id),
                preferredSearch: !enabled && value.preferredSearch === id ? null : value.preferredSearch,
              }))} />
            </div>
            {entry && <Field label={`${SEARCH_PROVIDERS[id]} API Key`}><Input required={!existing} type="password" autoComplete="new-password" maxLength={4096} value={entry.apiKey}
              placeholder={existing ? "已保存，留空保留" : "输入 API Key"} onChange={event => {
                const apiKey = event.target.value;
                edit(value => ({ ...value, search: value.search.map(item => item.id === id ? { id, apiKey } : item) }));
              }} /></Field>}
          </div>;
        })}
        {draft.search.length > 0 && <div className="px-5 py-4"><Field label="首选搜索提供商">
          <select className={selectClass} required value={preferredSearch ?? ""} onChange={event => {
            const id = searchIds.find(candidate => candidate === event.target.value) ?? null;
            edit(value => ({ ...value, preferredSearch: id }));
          }}>
            <option value="" disabled>选择搜索提供商</option>
            {searchIds.filter(id => draft.search.some(item => item.id === id)).map(id => <option key={id} value={id}>{SEARCH_PROVIDERS[id]}</option>)}
          </select>
        </Field></div>}
      </ProviderGroup>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-[12px] text-muted">{window.runtime.mode === "cloud" ? "Key 加密保存在服务器。" : "Key 加密保存在本机。"}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!!busy} onClick={() => void refresh()}><RefreshCw size={14} />{busy === "load" ? "加载中…" : dirty ? "放弃修改并刷新" : "刷新"}</Button>
        <Button type="submit" variant="primary" disabled={!!busy || (!dirty && !state.error)}>{busy === "save" ? "保存中…" : "保存配置"}</Button>
      </div>
    </div>
    {(error || state.error) && <p role="alert" className="mt-3 px-1 text-xs text-danger">{error || state.error}</p>}
    {saved && !dirty && <p role="status" className="mt-3 px-1 text-xs text-ok">已保存，下次调用工具时生效。</p>}
  </form>;
}
