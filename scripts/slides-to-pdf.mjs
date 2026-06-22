#!/usr/bin/env node
// slides-to-pdf.mjs — render docs/slides.html → docs/slides.pdf (one slide per page).
// Uses the Playwright Chromium already installed for the renderer (render/node_modules).
//   node scripts/slides-to-pdf.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));   // scripts/
const root = path.resolve(here, '..');                       // repo root
const require = createRequire(path.join(root, 'render', 'package.json'));
const { chromium } = require('playwright');

const html = 'file://' + path.join(root, 'docs', 'slides.html');
const out = path.join(root, 'docs', 'slides.pdf');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);            // let the waveform paint a frame
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: out, printBackground: true,
  width: '13.333in', height: '7.5in',
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log('wrote', out);
