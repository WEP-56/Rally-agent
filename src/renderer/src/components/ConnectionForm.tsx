import { useState } from "react";
import { bridge } from "../connection";
import { Button, Input } from "./ui";
export function ConnectionForm({ reason = "" }: { reason?: string }) {
	const state = window.runtime,
		[url, setUrl] = useState(state?.url ?? ""),
		[key, setKey] = useState(""),
		[error, setError] = useState(reason || state?.error || ""),
		[busy, setBusy] = useState(false);
	async function select(mode: "local" | "cloud") {
		if (state?.mode === "local" && !confirm("切换会退出本地 Rally 并停止本地运行中的工作。继续？")) return;
		setBusy(true);
		setError("");
		try {
			await bridge!.select(mode, url.trim(), key.trim());
		} catch (e) {
			setError(String(e));
			setBusy(false);
		}
	}
	return (
		<section className="glass-strong mx-auto w-full max-w-lg rounded-[24px] p-6">
			<h2 className="font-display text-xl font-semibold">运行模式</h2>
			<p className="mb-5 mt-2 text-sm text-muted">
				{state?.platform === "android"
					? "此设备连接云端 Rally。"
					: "本地使用这台电脑；云端的任务和文件保存在服务器。"}
			</p>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void select("cloud");
				}}
				className="grid gap-3"
			>
				<label>
					服务器地址
					<Input
						required
						type="url"
						placeholder="http://服务器IP:4711"
						value={url}
						list="profiles"
						onChange={(e) => setUrl(e.target.value)}
					/>
				</label>
				{url.startsWith("http://") && <p className="text-xs text-muted">HTTP 仅用于测试，连接内容不会加密。</p>}
				<datalist id="profiles">
					{state?.profiles?.map((p) => (
						<option key={p}>{p}</option>
					))}
				</datalist>
				<label>
					设备接入密钥
					<Input
						type="password"
						autoComplete="off"
						placeholder="已配对的地址可留空"
						value={key}
						onChange={(e) => setKey(e.target.value)}
					/>
				</label>
				<Button variant="primary" disabled={busy}>
					{busy ? "正在连接…" : "连接云端"}
				</Button>
			</form>
			{state?.platform === "desktop" && state.mode !== "local" && (
				<Button className="mt-4" disabled={busy} onClick={() => void select("local")}>
					使用本地模式
				</Button>
			)}
			{error && (
				<p role="alert" className="mt-3 break-words text-sm text-danger">
					{error}
				</p>
			)}
		</section>
	);
}
