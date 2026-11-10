import { useLayoutEffect, useSyncExternalStore } from "react";

const leases = new Set<symbol>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => leases.size > 0;
/** Native child views must hide while a DOM menu/modal needs to cover them. */
export function useBrowserOverlay(open: boolean): void {
	useLayoutEffect(() => {
		if (!open) return;
		const key = Symbol(); leases.add(key); for (const listener of listeners) listener();
		return () => { leases.delete(key); for (const listener of listeners) listener(); };
	}, [open]);
}
export function useBrowserObscured(): boolean { return useSyncExternalStore(subscribe, snapshot, () => false); }
