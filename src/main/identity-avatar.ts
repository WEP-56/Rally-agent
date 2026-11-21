import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { nativeImage } from "electron";

const MAX_BYTES = 5 * 1024 * 1024;

/** Decode only a user-selected raster image and persist a small, self-contained square. */
export function readAvatar(file: string): string {
	const fd = openSync(file, "r");
	let bytes: Buffer;
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) throw new Error("请选择 5 MiB 以内的图片");
		const buffer = Buffer.alloc(MAX_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, null);
			if (!count) break;
			length += count;
		}
		if (length > MAX_BYTES) throw new Error("请选择 5 MiB 以内的图片");
		bytes = buffer.subarray(0, length);
	} finally { closeSync(fd); }
	const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
	if (!png && !jpeg && !webp) throw new Error("支持 PNG、JPEG 和 WebP 图片");
	const image = nativeImage.createFromBuffer(bytes);
	const { width, height } = image.getSize();
	if (image.isEmpty() || width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error("图片无法读取或尺寸超过 8192 像素");
	const edge = Math.min(width, height);
	return image.crop({ x: Math.floor((width - edge) / 2), y: Math.floor((height - edge) / 2), width: edge, height: edge }).resize({ width: 256, height: 256, quality: "best" }).toDataURL();
}
