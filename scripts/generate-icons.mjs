import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";

// Keep the user's PNG as the single source; png-to-ico preserves alpha and emits
// 16, 32, 48 and 256 pixel images for Windows shell/DPI selection.
const source = fileURLToPath(new URL("../icon.png", import.meta.url));
const destination = new URL("../build/", import.meta.url);
const icon = await pngToIco(source);
await mkdir(destination, { recursive: true });
await writeFile(new URL("icon.ico", destination), icon);
console.log("Generated build/icon.ico from icon.png (16, 32, 48, 256 px)");
