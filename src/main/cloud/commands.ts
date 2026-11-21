import { createHmac, randomBytes } from "node:crypto";
import { IpcChannel as C } from "../../shared/ipc.ts";
import type { McpConfigurationState } from "../../shared/mcp.ts";
import type { ModelsState, ProviderEntry } from "../../shared/models.ts";
import type { businessHandlers } from "../business.ts";
import { PublicError } from "./http.ts";

/** Device-facing views: never serialize stored provider keys or arbitrary stdio arguments/headers. */
export function cloudCommands(base: ReturnType<typeof businessHandlers>) {
	const salt = randomBytes(32);
	const stamp = (data: unknown) => createHmac("sha256", salt).update(JSON.stringify(data)).digest("base64url");
	const keyRef = (p: ProviderEntry) => `已保存:${stamp([p.id, p.protocol, p.baseUrl, p.apiKey])}`;
	const modelRevision = (s: ModelsState) => stamp(s.providers);
	const checkRevision = (expected: string, received?: string) => {
		if (expected !== received) throw new PublicError("配置已被其他设备修改或服务已重启，请刷新后再保存", 409);
	};
	const maskModels = (s: ModelsState) => ({
		...s,
		revision: modelRevision(s),
		errors: s.errors.length ? ["提供商配置有误，请检查协议、地址与模型元数据"] : [],
		providers: s.providers.map((p) => ({ ...p, apiKey: p.apiKey ? keyRef(p) : "" })),
	});
	const maskMcp = (s: McpConfigurationState) => {
		const entries = Object.fromEntries(s.servers.map((v) => [v.name, { rallySaved: stamp([s.json, v.name]) }]));
		let autoEnableCodemode: boolean | undefined;
		try {
			const value = JSON.parse(s.json).autoEnableCodemode;
			if (typeof value === "boolean") autoEnableCodemode = value;
		} catch {
			/* Invalid JSON remains replaceable from the client. */
		}
		return {
			...s,
			revision: stamp(s.json),
			errors: s.errors.length ? ["服务端 MCP 配置无效，请替换配置后重试"] : [],
			servers: s.servers.map((v) => ({ ...v, address: v.transport === "stdio" ? "服务器命令" : "远程端点" })),
			json: JSON.stringify({ mcpServers: entries, autoEnableCodemode }, null, 2),
		};
	};
	function restoreEntry(s: McpConfigurationState, name: string, value: unknown) {
		if (value && typeof value === "object" && "rallySaved" in value) {
			if (Object.keys(value).length !== 1 || value.rallySaved !== stamp([s.json, name]))
				throw new PublicError("配置已改变，请刷新；要替换配置请填写完整内容", 409);
			return JSON.parse(s.json).mcpServers[name];
		}
		return value;
	}
	let modelSave: Promise<unknown> = Promise.resolve();
	return {
		...base,
		[C.identityInitialize]: base[C.identityState],
		[C.modelsState]: async () => maskModels(await base[C.modelsState]()),
		[C.modelsSave]: (rows: ProviderEntry[], revision?: string) => {
			const save = modelSave
				.catch(() => {})
				.then(async () => {
					if (!Array.isArray(rows)) throw new Error("提供商列表无效");
					const current = await base[C.modelsState]();
					checkRevision(modelRevision(current), revision);
					const old = current.providers;
					return maskModels(
						await base[C.modelsSave](
							rows.map((p) => {
								if (!p.apiKey?.startsWith("已保存:")) return p;
								const saved = old.find(
									(o) =>
										o.id === p.id &&
										o.baseUrl === p.baseUrl &&
										o.protocol === p.protocol &&
										keyRef(o) === p.apiKey,
								);
								if (!saved) throw new PublicError("请刷新配置；更换服务地址时需重新输入密钥");
								return { ...p, apiKey: saved.apiKey };
							}),
						),
					);
				});
			modelSave = save;
			return save;
		},
		[C.modelsFetch]: async (p: ProviderEntry) => {
			let input = p;
			if (p.apiKey?.startsWith("已保存:")) {
				const old = (await base[C.modelsState]()).providers.find(
					(o) => o.baseUrl === p.baseUrl && o.protocol === p.protocol && keyRef(o) === p.apiKey,
				);
				if (!old) throw new PublicError("请重新输入密钥");
				input = { ...p, apiKey: old.apiKey };
			}
			const result = await base[C.modelsFetch](input);
			return result.ok ? result : { ok: false as const, error: "无法获取模型列表，请检查提供商地址、协议和密钥" };
		},
		[C.modelsSelectWorker]: async (input: unknown) => maskModels(await base[C.modelsSelectWorker](input)),
		[C.mcpState]: () => maskMcp(base[C.mcpState]()),
		[C.mcpSave]: (text: string, revision?: string) => {
			const s = base[C.mcpState]();
			checkRevision(stamp(s.json), revision);
			const data = JSON.parse(text);
			if (
				!data.mcpServers ||
				Array.isArray(data.mcpServers) ||
				typeof data.mcpServers !== "object" ||
				Object.keys(data).some((k) => !["mcpServers", "autoEnableCodemode"].includes(k))
			)
				throw new PublicError("请填写 mcpServers 对象");
			return maskMcp(
				base[C.mcpSave](
					JSON.stringify({
						autoEnableCodemode: data.autoEnableCodemode,
						mcpServers: Object.fromEntries(
							Object.entries(data.mcpServers).map(([k, v]) => [k, restoreEntry(s, k, v)]),
						),
					}),
				),
			);
		},
		[C.mcpSaveServer]: (name: string, json: string, old?: string, revision?: string) => {
			const s = base[C.mcpState]();
			checkRevision(stamp(s.json), revision);
			return maskMcp(
				base[C.mcpSaveServer](
					name,
					JSON.stringify(restoreEntry(s, old ?? name, JSON.parse(json))),
					old ?? undefined,
				),
			);
		},
		[C.mcpUpdate]: (...args: Parameters<(typeof base)[typeof C.mcpUpdate]>) => maskMcp(base[C.mcpUpdate](...args)),
		[C.mcpTier]: (...args: Parameters<(typeof base)[typeof C.mcpTier]>) => maskMcp(base[C.mcpTier](...args)),
		[C.mcpExposure]: (...args: Parameters<(typeof base)[typeof C.mcpExposure]>) =>
			maskMcp(base[C.mcpExposure](...args)),
	};
}
