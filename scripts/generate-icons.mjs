// Renders the SVG app icons to the PNG sizes browsers and iOS require.
//   node scripts/generate-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const jobs = [
  ["public/icons/icon.svg", "public/icons/icon-192.png", 192],
  ["public/icons/icon.svg", "public/icons/icon-512.png", 512],
  ["public/icons/icon-maskable.svg", "public/icons/icon-maskable-512.png", 512],
  ["public/icons/icon-maskable.svg", "public/icons/apple-touch-icon.png", 180],
  ["public/favicon.svg", "public/icons/favicon-32.png", 32],
];
const browser = await chromium.launch();
for (const [src, out, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(src, "utf8");
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log("wrote", out);
}
await browser.close();
