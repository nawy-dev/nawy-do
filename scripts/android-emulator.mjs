/* global fetch, WebSocket, setTimeout */
// Drives the installed app inside an Android emulator through its WebView (Chrome DevTools protocol
// over a plain WebSocket), the way a person would (ADR 0045): add a task, give it a time two minutes
// ahead, send the app to the background, then check that the PHONE rings it. CI only.
import { execSync } from 'node:child_process';

const PKG = 'todo.nawy.app';
const out = process.argv[2] ?? 'emulator-out';
const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (cmd) => execSync(`adb ${cmd}`).toString();

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const target = targets.find((t) => t.type === 'page') ?? targets[0];
if (!target) throw new Error('no WebView page found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('websocket failed'));
});
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    log('page exception:', JSON.stringify(msg.params.exceptionDetails?.exception?.description));
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    id += 1;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Runtime.enable');
/** Runs `code` in the page and returns its value. */
async function ev(code, userGesture = false) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${code} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture,
  });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error');
  }
  return r.result?.result?.value;
}
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const byLabel = (l) => document.querySelector('[aria-label="' + l + '"]');
  const setInput = (el, v) => {
    if (!el) throw new Error('input not found for ' + v);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const button = (re, root = document) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent + ' ' + (b.getAttribute('aria-label') ?? '')));
`;
const shot = (name) => adb(`exec-out screencap -p > ${out}/${name}.png`);

await sleep(3000);
log(
  'native?',
  JSON.stringify(
    await ev(
      `return { cap: window.Capacitor?.isNativePlatform?.(), bridge: window.androidBridge !== undefined };`,
    ),
  ),
);

const field = await ev(`${HELPERS} button(/نية جديدة/).click(); await wait(600);
  const input = document.querySelector('input[aria-label="ناوي تعمل إيه؟"], [aria-label="ناوي تعمل إيه؟"]');
  const r = input.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, iw: innerWidth, ih: innerHeight };`);

// Keyboard (ADR 0047 addendum): tap the field like a person, let the soft keyboard come up and ask
// the phone where it sits. The field must stay above it. Logged always; only a confidently read
// keyboard position can fail the run, so an emulator without a soft keyboard just logs.
adb('shell settings put secure show_ime_with_hard_keyboard 1');
const [pw, ph] = (adb('shell wm size').match(/(\d+)x(\d+)/) ?? []).slice(1).map(Number);
const k = pw / field.iw;
adb(`shell input tap ${Math.round(field.x * k)} ${Math.round(field.y * k)}`);
await sleep(2500);
shot('keyboard-add');
const shown = /mInputShown=true/.test(adb('shell dumpsys input_method'));
const after =
  await ev(`const i = document.querySelector('[aria-label="ناوي تعمل إيه؟"]'); const r = i.getBoundingClientRect();
  return { bottom: r.bottom, ih: innerHeight, focused: document.activeElement === i };`);
log('keyboard:', JSON.stringify({ screen: [pw, ph], shown, field, after }));
// With the keyboard up the page must either shrink to what is left (then the field is inside it) or
// the field must already sit above it. An emulator that shows no keyboard only logs.
if (shown && after.focused) {
  const shrank = after.ih < field.ih - 100;
  if (!shrank || after.bottom > after.ih) {
    log(
      'FAILED: the soft keyboard covers the new-task field',
      JSON.stringify({ shrank, ...after }),
    );
    process.exit(1);
  }
}
await ev(`${HELPERS}
  const input = document.querySelector('[aria-label="ناوي تعمل إيه؟"]');
  setInput(input, 'Emulator test'); await wait(300);
  button(/^\\s*إضافة/).click(); await wait(1500);`);
await ev(
  `${HELPERS} button(/تفاصيل: Emulator test/).click(); await wait(800); const edit = button(/^\\s*تعديل/); if (edit) { edit.click(); await wait(1000); }`,
);
shot('details-open');
log(
  'page after opening the details:',
  JSON.stringify(
    await ev(
      `return { dialogs: document.querySelectorAll('[role=dialog]').length, dates: document.querySelectorAll('input[type=date]').length, text: document.body.innerText.slice(0, 300) };`,
    ),
  ),
);

const when =
  await ev(`const d = new Date(Date.now() + 2 * 60000); const p = (n) => String(n).padStart(2, '0');
  return { date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), time: p(d.getHours()) + ':' + p(d.getMinutes()) };`);
log('due (device clock):', JSON.stringify(when));
await ev(`${HELPERS}
  const dlg = document;
  setInput(dlg.querySelector('input[type=date]'), ${JSON.stringify(when.date)}); await wait(300);
  setInput(dlg.querySelector('input[type=time]'), ${JSON.stringify(when.time)}); await wait(300);`);
shot('details');
await ev(`${HELPERS} button(/^\\s*حفظ/).click(); await wait(2500);`);
shot('saved');

// Swiping between the lists must never be read as a tap or a long press on a task (the details or
// the selection bar opening under the finger). Real touch input through the browser's own pipeline
// (Input.dispatchTouchEvent), starting on a task, with the speeds and drifts a thumb has.
await ev(`${HELPERS}
  for (const name of ['Swipe two', 'Swipe three']) {
    button(/نية جديدة/).click(); await wait(600);
    setInput(document.querySelector('[aria-label="ناوي تعمل إيه؟"]'), name); await wait(300);
    button(/^\\s*إضافة/).click(); await wait(1200);
  }`);
const touch = (type, x, y) =>
  send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function swipe({ dx, dy = 0, hold = 0, ms }, from) {
  const steps = Math.max(4, Math.round(ms / 16));
  await touch('touchStart', from.x, from.y);
  if (hold) await sleep(hold);
  for (let i = 1; i <= steps; i += 1) {
    await touch('touchMove', from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await sleep(ms / steps);
  }
  await touch('touchEnd', from.x + dx, from.y + dy);
}
const PAGE = `({
  dialogs: document.querySelectorAll('[role=dialog]').length,
  select: Boolean(document.querySelector('.select-bar')),
  view: document.querySelector('.nav [aria-current=page]')?.textContent ?? '',
  text: document.body.innerText.slice(0, 80).replace(/\\s+/g, ' '),
})`;
const cases = [
  { name: 'flick 40px/40ms', dx: 40, ms: 40 },
  { name: 'flick 90px/60ms', dx: 90, ms: 60 },
  { name: 'drag 150px/300ms', dx: 150, ms: 300 },
  { name: 'slow drag 150px/800ms', dx: 150, ms: 800 },
  { name: 'short 14px/80ms', dx: 14, ms: 80 },
  { name: 'short 22px/120ms', dx: 22, ms: 120 },
  { name: 'diagonal 70x25/150ms', dx: 70, dy: 25, ms: 150 },
  { name: 'hold 300ms then 100px/200ms', dx: 100, hold: 300, ms: 200 },
  { name: 'hold 450ms then 100px/200ms', dx: 100, hold: 450, ms: 200 },
  { name: 'hold 600ms then 100px/200ms', dx: 100, hold: 600, ms: 200 },
];
const bad = [];
for (const c of cases) {
  for (const dir of [-1, 1]) {
    const from = await ev(`${HELPERS}
      const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && /تفاصيل: /.test(e.getAttribute('aria-label') ?? e.textContent));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: Math.min(Math.max(r.x + r.width / 2, 120), innerWidth - 120), y: r.y + r.height / 2 };`);
    if (!from) {
      log('swipe case skipped, no task visible:', c.name);
      continue;
    }
    const before = await ev(`return ${PAGE};`);
    await swipe({ ...c, dx: c.dx * dir }, from);
    await sleep(700);
    const after = await ev(`return ${PAGE};`);
    const opened = after.dialogs > before.dialogs || after.select !== before.select;
    log(
      'swipe',
      c.name,
      dir > 0 ? '→' : '←',
      JSON.stringify({ moved: before.view !== after.view, opened }),
    );
    if (opened) {
      bad.push(`${c.name} ${dir > 0 ? '→' : '←'}`);
      shot('swipe-' + bad.length);
      adb('shell input keyevent KEYCODE_BACK');
      await sleep(800);
    }
  }
}
log('swipes that opened a task or the selection bar:', JSON.stringify(bad));
if (process.env.SWIPE_STRICT === '1' && bad.length) {
  log('FAILED: a swipe between lists was read as a press');
  process.exit(1);
}

// Safe areas (ADR 0047). The emulator's WebView may be older than Chromium 140: then Capacitor pads
// the WebView itself and both env() and the variable are 0, so this cannot reproduce the overlap a
// current WebView shows on a real phone. What it CAN check: the shell's top padding is the larger of
// the two sources, and the side menu opens (screenshot kept).
const insets = await ev(`${HELPERS}
  const probe = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;visibility:hidden;padding-top:' + css; document.body.append(d); const v = parseFloat(getComputedStyle(d).paddingTop); d.remove(); return v; };
  const env = probe('env(safe-area-inset-top, 0px)');
  const cap = probe('var(--safe-area-inset-top, 0px)');
  const pad = parseFloat(getComputedStyle(document.querySelector('.shell')).paddingTop);
  document.querySelector('[aria-label="القائمة الجانبية"]').click(); await wait(800);
  const head = document.querySelector('.drawer-head').getBoundingClientRect().top;
  const drawerPad = parseFloat(getComputedStyle(document.querySelector('.drawer')).paddingTop);
  document.querySelector('.drawer-backdrop')?.click(); await wait(300);
  return { env, cap, pad, head, drawerPad };`);
log('insets:', JSON.stringify(insets));
shot('drawer-insets');
log(
  adb('shell dumpsys webviewupdate')
    .split('\n')
    .find((l) => /Current WebView package|versionName/.test(l)) ?? 'webview: unknown',
);
const want = Math.max(insets.env, insets.cap);
if (insets.pad < want || insets.drawerPad < 8 + want) {
  log(
    'FAILED: the shell or the side menu ignores the safe area',
    JSON.stringify({ want, ...insets }),
  );
  process.exit(1);
}

// Let the app hand the plan to the phone, then ask the phone (not the app) what it holds.
await sleep(3000);
const alarms = adb(`shell dumpsys alarm`);
const held = alarms.split('\n').filter((l) => l.includes(PKG)).length;
log('alarm lines mentioning the app:', held);

// Backup out (ADR 0046): the WebView cannot download, so the file must be written to the app's cache
// and the system share sheet must open for it.
log(
  'menu:',
  JSON.stringify(
    await ev(`${HELPERS}
  const visible = (el) => el.getClientRects().length > 0;
  const menu = [...document.querySelectorAll('button')].find((b) => visible(b) && b.getAttribute('aria-label') === 'القائمة الجانبية');
  if (!menu) return { noDrawerButton: true };
  menu.click(); await wait(800);
  const mine = [...document.querySelectorAll('button.drawer-item')].find((e) => /بياناتي/.test(e.textContent));
  if (!mine) return { items: [...document.querySelectorAll('button')].filter(visible).map((e) => e.textContent.trim()).slice(0, 15) };
  mine.click(); await wait(1200);
  const exp = [...document.querySelectorAll('button')].find((b) => visible(b) && /تنزيل نسخة احتياطية/.test(b.textContent));
  if (!exp) return { noExport: document.body.innerText.slice(0, 200) };
  exp.click(); await wait(3000);
  return 'clicked';`),
  ),
);
shot('share-sheet');
const cache = adb(`shell run-as ${PKG} ls cache`);
const windows = adb('shell dumpsys window windows');
const wrote = /nawy-do-.*\.json/.test(cache);
const chooser = /Chooser|Sharesheet|ShareSheet/i.test(windows);
log('backup file in the app cache:', wrote, '| share sheet on screen:', chooser);
if (!wrote || !chooser) {
  log('FAILED: backup export through the share sheet');
  process.exit(1);
}

// Import: close the share sheet, press "import from a file" (with a user gesture, as a tap is) and
// ask the phone whether the system file picker came up. Picking a file is the person's part.
adb('shell input keyevent KEYCODE_BACK');
await sleep(2000);
await ev(
  `${HELPERS}
  const imp = button(/استيراد من ملف/);
  if (!imp) throw new Error('import button not found: ' + document.body.innerText.slice(0, 200));
  imp.click(); await wait(3000);`,
  true,
);
shot('file-picker');
const pickerWindows = adb('shell dumpsys window windows');
const picker = /documentsui|DocumentsActivity|FilesActivity|PickerActivity/i.test(pickerWindows);
log('system file picker on screen:', picker);
if (!picker) {
  log('FAILED: "import from a file" did not open the system file picker');
  process.exit(1);
}
adb('shell input keyevent KEYCODE_BACK');
await sleep(1500);
ws.close();

// The app goes to the background and its process is ended: the reminder has to come from the phone.
adb('shell input keyevent KEYCODE_HOME');
await sleep(2000);
adb(`shell am kill ${PKG}`);
await sleep(1000);
log('app process after kill:', JSON.stringify(adb(`shell pidof ${PKG} || true`).trim()));

log('waiting for the reminder to ring…');
await sleep(150_000);
adb('shell cmd statusbar expand-notifications');
await sleep(2000);
shot('shade');
const dump = adb('shell dumpsys notification --noredact');
const posted = dump.includes('Emulator test') && dump.includes(`pkg=${PKG}`);
log('reminder posted while the app was closed:', posted);
if (!posted || held === 0) {
  log('FAILED: posted =', posted, ', alarm lines =', held);
  process.exit(1);
}
log('OK: the phone rang the reminder');
