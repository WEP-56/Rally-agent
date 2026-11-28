import { useState } from "react";
import type { CredentialState } from "../../../shared/credentials";
import { useCredentials } from "../credentials";
import { Button } from "./ui";
import { PrivateAccountFields, privateCredentialInput } from "./CredentialCard";

export function WebsiteAccountsSection() {
	const { state, setState, error } = useCredentials();
	const [failure, setFailure] = useState("");
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<string>();
	const [clearing, setClearing] = useState(false);
	const [notice, setNotice] = useState("");
	const run = async (operation: Promise<CredentialState>) => {
		setBusy(true); setFailure("");
		try { setState(await operation); } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
	};
	return <section className="space-y-4">
		<p className="text-sm text-muted">启用的账号和密钥可供任务在命令行、API、浏览器等场景使用。停用或删除后不再提供给新调用；已有进程和浏览器登录态不会自动退出。</p>
		<div className="rounded-2xl bg-md-surface-low p-4 text-sm"><p className="mb-3 text-muted">所有任务共用浏览器登录态。清除会退出所有网站并删除网站本地数据；需先结束浏览器任务，保存的账号仍保留。</p>
			<Button disabled={busy} onClick={() => setClearing(!clearing)}>{clearing ? "取消清除" : "清除浏览器登录态"}</Button>
			{clearing && <Button disabled={busy} onClick={() => { setBusy(true); setFailure(""); void window.rally.credentials.clearLogin().then(() => { setClearing(false); setNotice("浏览器登录态已清除"); }).catch(error => setFailure(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)); }}>确认退出所有网站</Button>}
			{notice && <p role="status" className="mt-2 text-muted">{notice}</p>}
		</div>
		{(failure || error) && <p role="alert" className="text-danger">{failure || error}</p>}
		{!state.accounts.length && <p className="text-sm text-muted">密码本还是空的。任务需要账号或密钥时，助手会在对话里发起私密填写申请。</p>}
		{state.accounts.map(account => <div key={account.id} className="rounded-[24px] bg-md-surface-low bg-panel p-5">
			<div className="break-all font-medium">{account.label || account.origin}</div>{account.label && <div className="mt-1 break-all text-xs text-muted">{account.origin}</div>}<div className="my-2 text-xs text-muted">{account.kind === "secret" ? "密钥 / Token" : "账号和密码"} · {account.enabled ? "已启用" : "已停用"} · {new Date(account.createdAt).toLocaleString()}</div>
			<div className="flex gap-2"><Button disabled={busy} onClick={() => setEditing(editing === account.id ? undefined : account.id)}>{editing === account.id ? "取消修改" : "修改"}</Button><Button disabled={busy} onClick={() => void run(window.rally.credentials.update(account.id, !account.enabled))}>{account.enabled ? "停用" : "启用"}</Button><Button disabled={busy} onClick={() => void run(window.rally.credentials.remove(account.id))}>删除</Button></div>
			{editing === account.id && <form className="mt-4" onSubmit={event => {
				event.preventDefault(); if (busy) return;
				const input = privateCredentialInput(new FormData(event.currentTarget));
				event.currentTarget.reset();
				void run(window.rally.credentials.replace(account.id, input).then(state => { setEditing(undefined); return state; }));
			}}><PrivateAccountFields initialKind={account.kind} initialLabel={account.label} /><p className="mb-3 text-xs text-muted">重新填写并保存后，下次调用使用新凭据。已有进程和网站登录状态不会自动切换。</p><Button type="submit" disabled={busy}>保存修改</Button></form>}
		</div>)}
	</section>;
}
