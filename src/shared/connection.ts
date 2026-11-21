export interface ConnectionState {
	mode: "choose" | "local" | "cloud";
	url: string;
	instance: string;
	platform: "desktop" | "android";
	engine?: string;
	profiles?: string[];
	error?: string;
}
export interface ConnectionBridge {
	state(): Promise<ConnectionState>;
	select(mode: "local" | "cloud", url: string, key: string): Promise<void>;
	request<T>(endpoint: "rpc" | "events", body: object): Promise<T>;
}

export function connectionUrl(input: string): string {
	const url = new URL(input.trim());
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.pathname !== "/" && url.pathname !== "")
	) {
		throw new Error("请输入 HTTP 或 HTTPS 服务地址（域名或 IP:端口，不带路径）");
	}
	return url.origin;
}
