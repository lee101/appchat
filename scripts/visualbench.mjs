#!/usr/bin/env node
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const rawBase = process.argv[2] || 'http://127.0.0.1:3000';
const parsedBase = new URL(rawBase);
if (!path.posix.extname(parsedBase.pathname) && !parsedBase.pathname.endsWith('/')) {
  parsedBase.pathname += '/';
}
const base = parsedBase.toString();
const outDir = path.resolve('visualbench');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const cases = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 }
];

const results = [];
for (const item of cases) {
  const page = await browser.newPage({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: 1 });
  const started = Date.now();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, `appchat-${item.name}.png`), fullPage: true });
  const metrics = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.slice(0, 500),
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    buttons: document.querySelectorAll('button').length,
    svgNodes: document.querySelectorAll('svg .sector').length
  }));
  results.push({ ...item, ms: Date.now() - started, ...metrics });
  await page.close();
}

await browser.close();
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify({ base, results }, null, 2));

const bad = results.find((r) => r.overflowX || r.svgNodes < 5 || r.buttons < 5);
if (bad) {
  console.error(`VisualBench failed: ${bad.name} overflow=${bad.overflowX} svgNodes=${bad.svgNodes} buttons=${bad.buttons}`);
  process.exit(1);
}
console.log(`VisualBench wrote ${outDir}`);
