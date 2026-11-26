import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { connect, disconnect, isConnected } from "./connection";
import { ConnectionForm } from "./components/ConnectionForm";
import { Button, RallyLogo } from "./components/ui";
import { useAppearance } from "./appearance";
import { loadConfig } from "./store";

declare global {
	interface Window {
		rallyStartup?: { ready(): void; fail(reason: unknown): void };
	}
}
function Ready() {
	useEffect(() => window.rallyStartup?.ready(), []);
	return null;
}
function SetupAppearance() {
	useAppearance(loadConfig());
	return null;
}
function Connected() {
	const [online, setOnline] = useState(isConnected);
	useEffect(() => {
		setOnline(isConnected());
		const cb = (event: Event) => setOnline((event as CustomEvent<boolean>).detail);
		window.addEventListener("rally-network", cb);
		return () => window.removeEventListener("rally-network", cb);
	}, []);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<Ready />
			{!online && (
				<div
					className="flex flex-wrap items-center justify-between gap-2 bg-warn-soft px-4 py-2 text-sm"
					role="status"
				>
					正在连接服务器，当前显示本机缓存。
					<Button size="sm" onClick={() => setup("连接已断开，可切换服务器或重新配对。")}>
						连接设置
					</Button>
				</div>
			)}
			<div className="min-h-0 flex-1">
				<App />
			</div>
		</div>
	);
}
const root = createRoot(document.getElementById("root")!, {
	onUncaughtError: (error) => window.rallyStartup?.fail(error),
});
function setup(reason = "") {
	disconnect();
	root.render(
		<main className="flex h-full flex-col overflow-auto bg-app">
			<Ready />
			<SetupAppearance />
			{window.rallyLocal && (
				<div className="drag flex h-10 shrink-0 justify-end">
					<button
						className="no-drag w-12 hover:bg-danger/10"
						aria-label="关闭窗口"
						onClick={() => window.rallyLocal?.window.close()}
					>
						×
					</button>
				</div>
			)}
			<div className="relative mx-auto flex w-full max-w-[600px] flex-1 flex-col justify-center gap-6 px-5 py-8">
				<header className="text-center">
					<RallyLogo size={64} className="mx-auto rounded-2xl shadow-pop" />
					<p className="mt-5 text-xs tracking-[0.25em] text-faint">RALLY · {reason ? "CONNECTION" : "WELCOME"}</p>
					<h1 className="mt-2 text-2xl font-semibold tracking-tight">{reason ? "重新连接你的 Rally" : "让 Rally 从这里开始"}</h1>
					<p className="mt-2 text-sm text-muted">{reason ? "检查当前连接，或选择另一处运行位置。" : "先选择运行位置，接着设置你的 Agent、记忆与模型。"}</p>
				</header>
				<div className="glass-strong rounded-3xl p-5 sm:p-6"><ConnectionForm reason={reason} /></div>
				{reason && <Button onClick={() => location.reload()}>返回并重试原连接</Button>}
			</div>
		</main>,
	);
}
void connect()
	.then((state) =>
		state.mode === "choose"
			? setup()
			: root.render(
					<StrictMode>
						<Connected />
					</StrictMode>,
				),
	)
	.catch((error) => setup(String(error)));
