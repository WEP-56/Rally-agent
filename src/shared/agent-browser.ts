export type BrowserOwner = "agent" | "taking" | "user" | "waiting" | "closed";
export interface AgentBrowserWindow {
	id: string;
	taskId: string;
	runId: string;
	createdAt: number;
	owner: BrowserOwner;
	epoch: number;
	document: number;
	origin: string;
	operation: string;
	tabs?: { id: string; origin: string; active: boolean }[];
}
export interface BrowserObservation {
	windowId: string;
	epoch: number;
	document: number;
	snapshot: string;
	tabs?: { id: string; origin: string; active: boolean }[];
	downloads?: { id: string; name: string }[];
}
export interface BrowserFrame {
	windowId: string;
	epoch: number;
	document: number;
	seq: number;
	width: number;
	height: number;
	data: string;
}
export type AgentBrowserAction =
	| { kind: "tab"; tabId: string; close?: boolean }
	| { kind: "click"; ref: string }
	| { kind: "fill"; ref: string; text: string }
	| { kind: "press"; ref: string; key: string }
	| { kind: "select"; ref: string; values: string[] }
	| { kind: "scroll"; x: number; y: number };
export type BrowserUserInput =
	| { kind: "tab"; tabId: string }
	| { kind: "click"; x: number; y: number }
	| { kind: "drag"; points: { x: number; y: number }[] }
	| { kind: "text"; text: string }
	| { kind: "key"; key: string }
	| { kind: "scroll"; x: number; y: number };
