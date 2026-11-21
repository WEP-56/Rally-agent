import { createHash } from "node:crypto";
import { connectionUrl } from "../shared/connection.ts";

export interface Profile {
	url: string;
	instance: string;
	secret: string;
}
export interface SavedConnections {
	active: string;
	profiles: Profile[];
}

export function parseConnections(value: unknown): SavedConnections {
	if (
		!value ||
		typeof value !== "object" ||
		!("active" in value) ||
		typeof value.active !== "string" ||
		!("profiles" in value) ||
		!Array.isArray(value.profiles)
	)
		throw Error("连接档案格式无效");
	const profiles: Profile[] = [];
	for (const row of value.profiles) {
		if (
			!row ||
			typeof row !== "object" ||
			typeof row.url !== "string" ||
			typeof row.instance !== "string" ||
			!/^[a-f0-9-]{36}$/.test(row.instance) ||
			typeof row.secret !== "string" ||
			row.secret.length > 4096 ||
			!/^[A-Za-z0-9+/=]+$/.test(row.secret)
		)
			throw Error("连接档案格式无效");
		const url = connectionUrl(row.url);
		if (url !== row.url || profiles.some((p) => p.url === url)) throw Error("连接档案地址无效");
		profiles.push({ url, instance: row.instance, secret: row.secret });
	}
	return { active: value.active, profiles };
}

export function profilePartition(profile: Pick<Profile, "url" | "instance">): string {
	return (
		"persist:cloud-" +
		createHash("sha256")
			.update(JSON.stringify([profile.url, profile.instance]))
			.digest("hex")
	);
}
