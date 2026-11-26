import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { imagesToIco } from "png-to-ico";
import { readPNG, resize } from "png-to-ico/lib/png.js";

// Keep the supplied artwork untouched. All shipped images derive from this file.
const source = await readPNG(fileURLToPath(new URL("../docs/icon.png", import.meta.url)));
if (source.width !== source.height) throw new Error("docs/icon.png must be square");
removeCornerMatte(source);

const build = new URL("../build/", import.meta.url);
const assets = new URL("../src/renderer/src/assets/", import.meta.url);
await mkdir(build, { recursive: true });
await mkdir(assets, { recursive: true });
const sizes = [16, 32, 48, 256];
await writeFile(new URL("icon.ico", build), imagesToIco(sizes.map(size => resize(source, size, size))));
await writePng(new URL("icon.png", build), resize(source, 512, 512));
await writePng(new URL("rally-mark.png", assets), resize(source, 320, 320));
await writePng(new URL("rally-favicon.png", assets), resize(source, 64, 64));
console.log("Generated transparent Rally icons from docs/icon.png: Windows ICO, 512px app icon, 320px mark, 64px favicon");

function writePng(path, image) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    image.on("data", chunk => chunks.push(chunk));
    image.on("error", reject);
    image.on("end", () => writeFile(path, Buffer.concat(chunks)).then(resolve, reject));
    image.pack();
  });
}

/** Remove only the black matte connected to the four corners, never dark artwork. */
function removeCornerMatte(image) {
  const { width, height, data } = image;
  const corners = [0, width - 1, width * (height - 1), width * height - 1];
  const brightness = index => Math.max(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]);
  // Already-transparent artwork needs no matting. Do not alter a future full-bleed icon.
  if (!corners.every(index => data[index * 4 + 3] === 255 && brightness(index) < 24)) return;
  const outside = new Uint8Array(width * height);
  const pending = [...corners];
  while (pending.length) {
    const index = pending.pop();
    if (outside[index] || brightness(index) >= 240) continue;
    outside[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) pending.push(index - 1);
    if (x + 1 < width) pending.push(index + 1);
    if (y > 0) pending.push(index - width);
    if (y + 1 < height) pending.push(index + width);
  }
  for (let index = 0; index < outside.length; index++) {
    if (!outside[index]) continue;
    const offset = index * 4;
    const value = brightness(index);
    data[offset + 3] = 0;
    if (value < 24) continue;
    // Recover the light rounded edge from its black matte to avoid a dark fringe.
    const x = index % width;
    const y = Math.floor(index / width);
    let inner = -1;
    let nearest = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const neighbor = (y + dy) * width + x + dx;
        const distance = dx * dx + dy * dy;
        if (!outside[neighbor] && distance < nearest) { inner = neighbor; nearest = distance; }
      }
    }
    if (inner < 0) continue;
    data[offset + 3] = Math.round(255 * (value - 24) / (brightness(inner) - 24));
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = data[inner * 4 + channel];
  }
}
