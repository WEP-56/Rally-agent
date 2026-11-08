// Window globals provided by the preload script.

/// <reference types="vite/client" />

import type { RallyApi } from "../../shared/ipc";

declare global {
	interface Window {
		rally: RallyApi;
	}
}
