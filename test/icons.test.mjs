// The site's icons (web/favicon.svg, and favicon.ico and apple-touch-icon.png drawn from it by dev/make-icons.mjs): the files
// are what the pages link, in the sizes browsers ask for.
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loginPage } from "../server/auth.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (buf) => (buf.subarray(0, 8).equals(PNG) ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);
const links = (html) => [...html.matchAll(/<link rel="(icon|apple-touch-icon)"[^>]*>/g)].map((m) => m[0]);

test("the pages link the icons: the .ico with sizes (so Chrome takes the SVG), the SVG with its type, the Apple touch icon", () => {
  const index = links(readFileSync(join(WEB, "index.html"), "utf8"));
  assert.deepEqual(index, [
    '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  ]);
  assert.deepEqual(links(loginPage()), index, "the login page links the same icons");
});

test("favicon.svg: the board's ink and paper, and lines that turn light in dark mode", () => {
  const svg = readFileSync(join(WEB, "favicon.svg"), "utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/);
  assert.match(svg, /stroke: #0a0a0c/);
  assert.ok(svg.includes("@media (prefers-color-scheme: dark) { .t { fill: none; } .s { stroke: #fcfcfd; } }"), "the dark rule");
});

test("favicon.ico: 16 and 32 px, each a PNG of that size", () => {
  const ico = readFileSync(join(WEB, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, "an icon");
  const n = ico.readUInt16LE(4), sizes = [];
  for (let k = 0; k < n; k++) {
    const e = 6 + 16 * k, size = ico.readUInt8(e), len = ico.readUInt32LE(e + 8), at = ico.readUInt32LE(e + 12);
    assert.deepEqual(pngSize(ico.subarray(at, at + len)), [size, size], `entry ${k}`);
    sizes.push(size);
  }
  assert.deepEqual(sizes, [16, 32]);
});

test("apple-touch-icon.png: 180 px and opaque (iOS shows transparency as black)", () => {
  const png = readFileSync(join(WEB, "apple-touch-icon.png"));
  assert.deepEqual(pngSize(png), [180, 180]);
  assert.equal(png.readUInt8(25), 2, "colour type 2: RGB without alpha");
});
