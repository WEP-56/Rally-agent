import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAvatar } from "../../../../src/main/identity-avatar.ts";
import { createHarness, type Harness } from "./harness.ts";

const decode = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: decode } }));
describe("local avatar input boundary", () => {
	const harnesses: Harness[] = [];
	afterEach(() => { harnesses.splice(0).forEach(harness => harness.cleanup()); decode.mockReset(); });
	async function fixture(bytes: Buffer | string) { const harness = await createHarness(); harnesses.push(harness); const file = join(harness.tempDir, "input.png"); writeFileSync(file, bytes); return file; }
	it("rejects non-raster and oversized files before decoding", async () => {
		for (const bytes of ["<svg onload='bad()'/>", "", Buffer.alloc(5 * 1024 * 1024 + 1)]) { const file = await fixture(bytes); expect(() => readAvatar(file)).toThrow(); }
		expect(decode).not.toHaveBeenCalled();
	});
	it("center-crops a selected image and normalizes it to 256 pixel PNG", async () => {
		const resize = vi.fn(() => ({ toDataURL: () => "data:image/png;base64,normalized" })); const crop = vi.fn(() => ({ resize }));
		decode.mockReturnValue({ getSize: () => ({ width: 600, height: 400 }), isEmpty: () => false, crop });
		expect(readAvatar(await fixture(Buffer.from([255, 216, 255, 0])))).toBe("data:image/png;base64,normalized");
		expect(crop).toHaveBeenCalledWith({ x: 100, y: 0, width: 400, height: 400 });
		expect(resize).toHaveBeenCalledWith({ width: 256, height: 256, quality: "best" });
	});
	it("rejects undecodable or excessively large images", async () => {
		for (const image of [{ getSize: () => ({ width: 0, height: 0 }), isEmpty: () => true }, { getSize: () => ({ width: 8193, height: 1 }), isEmpty: () => false }]) {
			decode.mockReturnValue(image); const file = await fixture(Buffer.from([255, 216, 255, 0])); expect(() => readAvatar(file)).toThrow("图片无法读取");
		}
	});
});
