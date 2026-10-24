// Records the demo video: drives the running app with Playwright, holding each
// scene for the length of its narration clip, and writes timeline.json so the
// narration can be laid over the recording at the right offsets.
//
// Usage: node record.mjs <audioDir> <outDir> [baseUrl]
// Needs `npm i playwright` and a running Rebuttal server in mock mode.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [audioDir, outDir, base = 'http://localhost:3000'] = process.argv.slice(2);
const W = 1366;
const H = 768;

function wavSeconds(file) {
  const buf = fs.readFileSync(file);
  const byteRate = buf.readUInt32LE(28);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return size / byteRate;
    off += 8 + size;
  }
  throw new Error(`no data chunk in ${file}`);
}

const dur = Object.fromEntries(fs.readdirSync(audioDir).filter((f) => f.endsWith('.wav')).map((f) => [f.replace('.wav', ''), wavSeconds(path.join(audioDir, f))]));

fs.mkdirSync(outDir, { recursive: true });
await fetch(`${base}/api/demo/reset`, { method: 'POST' });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: outDir, size: { width: W, height: H } }, deviceScaleFactor: 1 });
const page = await context.newPage();
const t0 = Date.now();
const timeline = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A visible cursor, since headless recordings have none.
const CURSOR = `(() => {
  if (document.getElementById('__cur')) return;
  const c = document.createElement('div'); c.id = '__cur';
  c.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:transform .08s;left:-50px;top:-50px';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5"/></svg>';
  document.documentElement.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.8)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = ''; }, true);
})()`;
await page.addInitScript(CURSOR);
let mouse = { x: W / 2, y: H / 2 };

async function moveTo(locator, { click = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x + Math.min(box.width / 2, 120);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  mouse = { x, y };
  if (click) {
    await sleep(150);
    await page.mouse.down();
    await page.mouse.up();
  }
}

async function scene(id, fn) {
  const start = (Date.now() - t0) / 1000;
  timeline.push({ id, start });
  const target = start + (dur[id] || 3) + 0.6;
  await fn();
  const left = target - (Date.now() - t0) / 1000;
  if (left > 0) await sleep(left * 1000);
}

const scrollCaseTo = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
}, sel);

async function openCase(id) {
  await page.waitForTimeout(300);
  await moveTo(page.locator(`.qcard[data-id="${id}"]`), { click: true });
  await page.waitForFunction((d) => document.querySelector('.chead .sub')?.textContent.includes(d), id);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
}

// ---- title card ----
const card = (title, sub) => `<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#173a63;color:#f6f3ec;font-family:Georgia,serif">
  <div style="text-align:center;max-width:980px;padding:40px"><div style="font-size:84px;font-weight:600;letter-spacing:.5px">${title}</div>
  <div style="font:400 26px/1.5 system-ui,sans-serif;opacity:.85;margin-top:18px">${sub}</div></div></body></html>`;

await scene('intro', async () => {
  await page.setContent(card('Rebuttal', 'AI dispute defense for PayPal sellers<br><span style="font-size:19px;opacity:.75">Decide which disputes to fight &middot; prove it with grounded evidence &middot; send it to PayPal in one click</span>'));
});

await scene('queue', async () => {
  await page.goto(base);
  await page.waitForSelector('.qcard[data-id]');
  await sleep(1200);
  await moveTo(page.locator('.kpi').nth(1));
  await sleep(1500);
  await moveTo(page.locator('.qcard[data-id]').first());
  await sleep(1500);
  await moveTo(page.locator('.qcard[data-id]').nth(1));
});

await scene('fraud', async () => {
  await openCase('PP-D-1004');
  await sleep(2500);
  await moveTo(page.locator('.signals .sp').first());
});

await scene('verdict', async () => {
  await scrollCaseTo('.verdict');
  await sleep(900);
  await moveTo(page.locator('.gauge'));
  await sleep(1800);
  await moveTo(page.locator('.checks li').nth(3));
  await sleep(1500);
  await moveTo(page.locator('.checks li').nth(6));
});

await scene('draft', async () => {
  await scrollCaseTo('#ground');
  await sleep(900);
  await moveTo(page.locator('#ground'));
  await sleep(2000);
  await moveTo(page.locator('.cite[data-ex]').nth(2), { click: true });
  await sleep(2200);
  await scrollCaseTo('#ground');
});

await scene('approve', async () => {
  await scrollCaseTo('.actions');
  await sleep(800);
  await moveTo(page.locator('#approve'), { click: true });
  await page.waitForSelector('#result .result');
  await sleep(600);
  await scrollCaseTo('#result');
});

await scene('partial', async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(500);
  await openCase('PP-D-1003');
  await sleep(1800);
  await scrollCaseTo('.options');
  await sleep(800);
  await moveTo(page.locator('.opt').first());
  await sleep(2200);
  await moveTo(page.locator('.opt').nth(1));
  await sleep(1500);
  await scrollCaseTo('.actions');
  await sleep(500);
  await moveTo(page.locator('#buyerMsg'));
});

await scene('honest', async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(400);
  await openCase('PP-D-1002');
  await sleep(1200);
  await moveTo(page.locator('.chead .badge').first());
  await sleep(1800);
  await scrollCaseTo('.verdict');
  await sleep(600);
  await moveTo(page.locator('.checks li.fail').first());
});

await scene('guard', async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await openCase('PP-D-1001');
  await scrollCaseTo('#ground');
  await sleep(800);
  const row = page.locator('.sent', { hasText: 'delivered on' }).locator('[contenteditable]');
  await moveTo(row, { click: true });
  await row.evaluate((el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3);
    const i = node.textContent.search(/\d{4}-\d{2}-\d{2}/);
    const r = document.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 10);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await sleep(500);
  await page.keyboard.type('2026-10-20', { delay: 110 });
  await sleep(700);
  await scrollCaseTo('.actions');
  await sleep(500);
  await moveTo(page.locator('#approve'), { click: true });
  await page.waitForSelector('.sent.bad');
  await scrollCaseTo('#ground');
  await sleep(400);
  await moveTo(page.locator('.sent.bad .issues'));
});

await scene('prevent', async () => {
  await moveTo(page.locator('.tabs button[data-tab="prevention"]'), { click: true });
  await page.waitForSelector('#tab-prevention .panel');
  await sleep(2200);
  const sync = page.locator('#sync');
  if (await sync.count()) {
    await moveTo(sync, { click: true });
    await sleep(1500);
  }
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
});

await scene('outro', async () => {
  await page.setContent(card('Rebuttal', 'github.com/Joshuamathewj2/rebuttal<br><span style="font-size:19px;opacity:.75">PayPal Disputes API &middot; PayPal Tracking API &middot; Claude</span>'));
});

const total = (Date.now() - t0) / 1000;
await context.close();
await browser.close();
const video = fs.readdirSync(outDir).filter((f) => f.endsWith('.webm')).map((f) => path.join(outDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ video, total, timeline }, null, 2));
console.log(`recorded ${total.toFixed(1)}s -> ${video}`);
