// Draws web/favicon.ico (16 and 32 px) and web/apple-touch-icon.png (180 px, opaque, for iOS) from web/favicon.svg with headless
// Chrome, the same renderer the browser uses for the SVG itself. Run it after changing the SVG:
//   node dev/make-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { startChrome, TODO } from "./harness.mjs";

const WEB = path.join(TODO, "web");
const svg = `data:image/svg+xml;base64,${fs.readFileSync(path.join(WEB, "favicon.svg")).toString("base64")}`;
const chrome = await startChrome();
const page = await chrome.tab("about:blank", { width: 200, height: 200, scale: 1 });
await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

/** The icon drawn size × size px, the mark mark × mark px in the middle, on a transparent or a solid background */
async function draw(size, { mark = size, background = "transparent" } = {}) {
  await page.ev(`(async () => {
    document.body.style.margin = "0";
    document.body.innerHTML = '<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${background}"><img width="${mark}" height="${mark}" src="${svg}"></div>';
    await document.images[0].decode();
    return true })()`);
  const shot = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  return Buffer.from(shot.result.data, "base64");
}

/** An .ico holding PNG images (supported everywhere .ico is) */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, png], k) => {
    const e = 6 + 16 * k;
    head.writeUInt8(size % 256, e); head.writeUInt8(size % 256, e + 1); // 0 means 256
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); // planes, bits per pixel
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(([, png]) => png)]);
}

// one at a time: they are drawn on the same page
const images = [];
for (const size of [16, 32]) images.push([size, await draw(size)]);
fs.writeFileSync(path.join(WEB, "favicon.ico"), ico(images));
// iOS rounds the corners itself and shows a transparent background as black: a solid background in the board's paper color
fs.writeFileSync(path.join(WEB, "apple-touch-icon.png"), await draw(180, { mark: 112, background: "#fcfcfd" }));
for (const f of ["favicon.ico", "apple-touch-icon.png"]) console.log(`web/${f}: ${fs.statSync(path.join(WEB, f)).size} bytes`);
chrome.close();
process.exit(0);
