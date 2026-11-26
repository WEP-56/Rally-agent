import { ActionButton } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_FAST, SPRING_LAYOUT } from "../md3/springs";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { CredentialRequest, CredentialState } from "../../../shared/credentials";
import { Button } from "./ui";
import { BrowserOverlayLease, useBrowserOverlay } from "../browser-overlays";

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
  if (request.status !== "pending") return <motion.div layout layoutId={`credential-${request.id}`} transition={SPRING_LAYOUT} className="ml-8 inline-flex max-w-[448px] self-start rounded-full bg-md-surface-low px-3.5 py-1.5 text-xs text-muted">网站账号 · {request.origin} · {request.status === "saved" ? "已加密保存" : request.status === "expired" ? "申请已过期，请重新申请" : "已取消"}</motion.div>;
	return <motion.div layout layoutId={`credential-${request.id}`} initial={{ opacity: 0, scale: 0.93, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING_LAYOUT} className="ml-8 max-w-[448px] rounded-[24px] bg-md-surface-high p-4 text-sm">
		<div className="font-medium">添加网站账号</div><div className="my-1.5 break-all font-mono text-xs text-muted">{request.origin}</div>
		{request.purpose && <p className="mb-3 text-xs leading-relaxed text-muted">{request.purpose}</p>}
		{<div className="flex gap-2"><Button variant="primary" size="sm" onClick={() => setOpen(true)}>添加</Button><Button size="sm" disabled={busy} onClick={() => void run(() => window.rally.credentials.cancel(request.id))}>取消申请</Button></div>}
		{error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
		{createPortal(<AnimatePresence>{open && request.status === "pending" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/32 p-4 backdrop-blur-[3px]" onKeyDown={event => { if (event.key === "Escape" && !busy) setOpen(false); }}>
			<BrowserOverlayLease />
			<motion.form initial={{ opacity: 0, scale: 0.93, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 6 }} transition={SPRING_FAST} role="dialog" aria-modal="true" aria-label="添加网站账号" className="w-full max-w-md rounded-[28px] bg-md-surface-high p-6 shadow-pop" onKeyDown={event => {
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
				<h2 className="mb-4 font-display text-lg font-semibold">添加网站账号</h2>
				<label className="block text-sm">网站<input className="my-2 w-full rounded-xl bg-md-surface-lowest p-3 text-muted" value={request.origin} readOnly /></label>
				<PrivateAccountFields />
				<p className="my-3 text-xs leading-relaxed text-muted">加密保存在 Agent 所在机器。启用后可在此网站自动填写；账号密码不会放进聊天消息。</p>
				{error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
				<div className="flex justify-end gap-2"><Button type="button" disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "保存中…" : "保存并启用"}</Button></div>
			</motion.form>
		</motion.div>}</AnimatePresence>, document.body)}
	</motion.div>;
}

export function PrivateAccountFields() {
	const [showPassword, setShowPassword] = useState(false);
	return <>
		<label className="block text-sm">账号<input name="username" autoFocus autoComplete="off" required maxLength={4096} className="my-2 w-full rounded-xl bg-md-surface-low p-3" /></label>
		<label className="block text-sm">密码<input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" required maxLength={16384} className="my-2 w-full rounded-xl bg-md-surface-low p-3" /></label>
		<ActionButton type="button" aria-pressed={showPassword} className="mb-2 text-xs text-accent" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "隐藏密码" : "显示密码"}</ActionButton>
	</>;
}
