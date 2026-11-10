import { useEffect, useState } from "react";
import type { WorkspaceState } from "../../shared/workspace";

export function useWorkspace() {
	const [state, setState] = useState<WorkspaceState | null>(null);
	const [error, setError] = useState("");
	useEffect(() => {
		let received = false;
		let mounted = true;
		const unsubscribe = window.rally.workspace.onChange((next) => { received = true; setState(next); });
		void window.rally.workspace.getState().then((next) => { if (mounted && !received) setState(next); }).catch((error: unknown) => { if (mounted) setError(String(error)); });
		return () => { mounted = false; unsubscribe(); };
	}, []);
	return { state, error };
}
