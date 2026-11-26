import { useEffect, useState } from "react";
import type { CredentialState } from "../../shared/credentials";

export function useCredentials() {
	const [state, setState] = useState<CredentialState>({ accounts: [], requests: [] });
	const [error, setError] = useState("");
	useEffect(() => {
		let alive = true;
		const refresh = async () => {
			if (document.hidden) return;
			try {
				const next = await window.rally.credentials.getState();
				if (!next || !Array.isArray(next.accounts) || !Array.isArray(next.requests)) throw new Error("账号状态响应无效，请稍后重试");
				if (alive) { setState(next); setError(""); }
			}
			catch (error) { if (alive) setError(error instanceof Error ? error.message : String(error)); }
		};
		void refresh(); const timer = setInterval(() => void refresh(), 3000);
		document.addEventListener("visibilitychange", refresh);
		return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
	}, []);
	return { state, setState, error };
}
