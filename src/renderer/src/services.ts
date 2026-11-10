import { useEffect, useState } from "react";
import type { ServiceRecord } from "../../shared/services";

export function useServices() {
	const [services, setServices] = useState<ServiceRecord[]>([]);
	const [error, setError] = useState("");
	const [stopping, setStopping] = useState<string[]>([]);
	useEffect(() => {
		let alive = true; let received = false;
		const api = window.rally.services;
		const off = api.onChange(state => { received = true; if (alive) setServices(state.services); });
		void api.getState().then(state => { if (alive && !received) setServices(state.services); }).catch(reason => { if (alive) setError(String(reason)); });
		return () => { alive = false; off(); };
	}, []);
	const stop = async (id: string) => {
		setError(""); setStopping(ids => [...ids, id]);
		try { await window.rally.services.stop(id); }
		catch (reason) { setError(String(reason)); }
		finally { setStopping(ids => ids.filter(item => item !== id)); }
	};
	return { services, error, stopping, stop };
}
