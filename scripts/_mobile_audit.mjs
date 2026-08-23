/**
 * Mobile overflow audit.
 *
 * Reports, per route, whether the document scrolls horizontally and WHICH
 * elements are wider than the viewport. Eyeballing a narrow screenshot is not
 * evidence — a headless render can look wrong while the box model is fine, and
 * it can look fine while one table quietly pushes the body 40px wide.
 */
import WebSocket from 'ws';

const WIDTH = Number(process.argv[2] ?? 390);
const ROUTES = [
  '/',
  '/book',
  '/registry',
  '/challenge',
  '/verify',
  '/loan/2',
  '/docs',
  '/docs/coverage',
  '/docs/reference-challenger',
  '/docs/protocol',
];

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });

let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const m = ++id;
    pending.set(m, res);
    ws.send(JSON.stringify({ id: m, method, params }));
  });

await new Promise((r) => ws.on('open', r));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});

const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Only report the element itself overflowing, not inherited from a parent
    // that already reported — keeps the list to actual causes.
    if (r.right > vw + 1 || r.left < -1) {
      const parent = el.parentElement;
      const pr = parent ? parent.getBoundingClientRect() : null;
      const parentAlreadyOver = pr && (pr.right > vw + 1 || pr.left < -1);
      if (parentAlreadyOver) continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 110),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 48),
      });
    }
  }
  return JSON.stringify({
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    offenders: offenders.slice(0, 12),
  });
})()`;

console.log(`\nMobile audit @ ${WIDTH}px\n`);
let anyOverflow = false;

for (const route of ROUTES) {
  await send('Page.navigate', { url: `http://localhost:3000${route}` });
  await new Promise((r) => setTimeout(r, 3500));
  const out = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  const r = JSON.parse(out.result.value);
  const over = r.scrollWidth > r.clientWidth;
  if (over) anyOverflow = true;

  console.log(
    `${over ? 'OVERFLOW' : '   ok   '}  ${route.padEnd(28)} scrollWidth ${r.scrollWidth} / clientWidth ${r.clientWidth}`,
  );
  for (const o of r.offenders) {
    console.log(`             <${o.tag}> w=${o.w} left=${o.left} right=${o.right}`);
    console.log(`               class="${o.cls}"`);
    if (o.text) console.log(`               text="${o.text}"`);
  }
}

console.log(`\n${anyOverflow ? 'HORIZONTAL OVERFLOW FOUND' : 'No horizontal overflow on any route'}\n`);
ws.close();
process.exit(0);
