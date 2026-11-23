import { useState } from "react";
import { createPortal } from "react-dom";
import type { CredentialRequest, CredentialState } from "../../../shared/credentials";
import { Button } from "./ui";
import { useBrowserOverlay } from "../browser-overlays";

export function CredentialCard({ request, changed }: { request: CredentialRequest; changed(state: CredentialState): void }) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	useBrowserOverlay(open && request.status === "pending");
	const run = async (operation: () => Promise<CredentialState>) => {
		setBusy(true); setError("");
		try { changed(await operation()); setOpen(false); }
		catch (error) { setError(error instanceof Error ? error.message : String(error)); }
		finally { setBusy(false); }
	};
	return <div className="ml-8 max-w-[440px] rounded-[22px] border border-line bg-panel p-4 text-sm shadow-soft">
		<div className="font-medium">添加网站账号</div><div className="my-2 break-all text-muted">{request.origin}</div>
		{request.purpose && <p className="mb-3 text-muted">{request.purpose}</p>}
		{request.status === "pending" ? <div className="flex gap-2"><Button onClick={() => setOpen(true)}>添加</Button><Button disabled={busy} onClick={() => void run(() => window.rally.credentials.cancel(request.id))}>取消申请</Button></div> : <div className="text-muted">{request.status === "saved" ? "已加密保存" : request.status === "expired" ? "申请已过期，请重新申请" : "已取消"}</div>}
		{error && <p role="alert" className="mt-2 text-danger">{error}</p>}
		{open && request.status === "pending" && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onKeyDown={event => { if (event.key === "Escape" && !busy) setOpen(false); }}>
			<form role="dialog" aria-modal="true" aria-label="添加网站账号" className="w-full max-w-md rounded-[24px] border border-line bg-panel p-6 shadow-soft" onKeyDown={event => {
				if (event.key !== "Tab") return;
				const fields = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([readonly]),button:not([disabled])')];
				const first = fields[0], last = fields.at(-1);
				if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
				else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
			}} onSubmit={event => {
				if (busy) { event.preventDefault(); return; }
				event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
				const input = { requestId: request.id, website: request.origin, username: String(data.get("username")), password: String(data.get("password")) };
				form.reset(); void run(() => window.rally.credentials.submit(input));
			}}>
				<h2 className="mb-4 text-lg font-semibold">添加网站账号</h2>
				<label className="block text-sm">网站<input className="my-2 w-full rounded-xl border border-line bg-transparent p-3" value={request.origin} readOnly /></label>
				<PrivateAccountFields />
				<p className="my-3 text-xs text-muted">加密保存在 Agent 所在机器。启用后可在此网站自动填写；账号密码不会放进聊天消息。</p>
				{error && <p role="alert" className="mb-3 text-danger">{error}</p>}
				<div className="flex justify-end gap-2"><Button type="button" disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存并启用"}</Button></div>
			</form>
		</div>, document.body)}
	</div>;
}

export function PrivateAccountFields() {
	const [showPassword, setShowPassword] = useState(false);
	return <>
		<label className="block text-sm">账号<input name="username" autoFocus autoComplete="off" required maxLength={4096} className="my-2 w-full rounded-xl border border-line bg-transparent p-3" /></label>
		<label className="block text-sm">密码<input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required maxLength={16384} className="my-2 w-full rounded-xl border border-line bg-transparent p-3" /></label>
		<button type="button" aria-pressed={showPassword} className="mb-2 text-xs text-accent" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "隐藏密码" : "显示密码"}</button>
	</>;
}
