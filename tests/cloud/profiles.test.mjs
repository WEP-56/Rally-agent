import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionUrl } from "../../src/shared/connection.ts";
import { parseConnections, profilePartition } from "../../src/main/connection-profiles.ts";

test("canonical origins and isolated persistent cloud partitions", () => {
	assert.equal(connectionUrl(" HTTPS://EXAMPLE.COM:443/ "), "https://example.com");
	assert.equal(connectionUrl("http://127.0.0.1:4711/"), "http://127.0.0.1:4711");
	for (const invalid of ["file:///tmp", "https://user:key@example.com", "https://example.com/api", "https://example.com/?token=secret", "https://example.com/#secret"]) assert.throws(() => connectionUrl(invalid));
	const profile = { url: "http://127.0.0.1:4711", instance: "eb187ce8-38cd-4256-bdc9-420df5cc3d26", secret: "ZW5jcnlwdGVk" };
	assert.equal(profilePartition(profile), profilePartition({ ...profile, secret: "replacement" }));
	assert.notEqual(profilePartition(profile), profilePartition({ ...profile, url: "http://127.0.0.1:4712" }));
	assert.notEqual(profilePartition(profile), profilePartition({ ...profile, instance: "734bb0c2-4bee-4189-95be-bbb52de187f4" }));
	assert.match(profilePartition(profile), /^persist:cloud-[a-f0-9]{64}$/);
	assert.deepEqual(parseConnections({ active: profile.url, profiles: [profile] }), { active: profile.url, profiles: [profile] });
	assert.throws(() => parseConnections({ active: "local", profiles: [profile, profile] }));
	assert.throws(() => parseConnections({ active: "local", profiles: [{ ...profile, url: profile.url + "/api" }] }));
	assert.throws(() => parseConnections(null));
});
