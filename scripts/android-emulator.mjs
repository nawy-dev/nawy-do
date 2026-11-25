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
  new Promise((res, rej) => {
    id += 1;
    const mine = id;
    pending.set(mine, res);
    ws.send(JSON.stringify({ id: mine, method, params }));
    // A page that stops answering must say so (and what the phone was doing), not hang the run.
    setTimeout(() => {
      if (!pending.delete(mine)) return;
      log('NO ANSWER from the page to', method, 'in 40s; phone state follows');
      try {
        adb(`exec-out screencap -p > ${out}/no-answer.png`);
        log(
          adb(
            'shell dumpsys activity processes | grep -i "anr\\|not responding" | head -5 || true',
          ),
        );
        log(adb('logcat -b crash -d | tail -30 || true'));
        log(
          adb(
            'logcat -d | grep -i "todo.nawy\\|FATAL\\|has died\\|killing\\|am_crash\\|am_proc_died\\|Process: " | tail -40 || true',
          ),
        );
      } catch (e) {
        log('diagnostics failed:', String(e).slice(0, 120));
      }
      rej(new Error(`no answer to ${method}`));
    }, 40_000);
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
// Real touches from the system (adb input), not synthetic page events: the same pipeline a finger
// uses. First learn where the page sits on the screen by tapping on the title.
adb('shell settings put global hide_error_dialogs 1');

const probe = ev(
  `return await new Promise((r) => addEventListener('pointerdown', (e) => r({ x: e.clientX, y: e.clientY, iw: innerWidth }), { once: true, capture: true }));`,
);
await sleep(300);
adb('shell input tap 160 60');
const seen = await probe;
const sk = pw / seen.iw;
const origin = { x: 160 - seen.x * sk, y: 60 - seen.y * sk };
log('screen origin of the page:', JSON.stringify({ sk, ...origin }));
async function swipe({ dx, dy = 0, ms }, from) {
  const x1 = Math.round(origin.x + from.x * sk);
  const y1 = Math.round(origin.y + from.y * sk);
  adb(
    `shell input swipe ${x1} ${y1} ${Math.round(x1 + dx * sk)} ${Math.round(y1 + dy * sk)} ${ms}`,
  );
}
const PAGE = `({
  sheets: document.querySelectorAll('.sheet').length,
  drawers: document.querySelectorAll('.drawer').length,
  select: Boolean(document.querySelector('.select-bar')),
  view: document.querySelector('.nav [aria-current=page]')?.textContent ?? '',
  text: document.body.innerText.slice(0, 80).replace(/\\s+/g, ' '),
})`;
const cases = [
  { name: 'flick 40px/40ms', dx: 40, ms: 40 },
  { name: 'flick 60px/30ms', dx: 60, ms: 30 },
  { name: 'flick 90px/60ms', dx: 90, ms: 60 },
  { name: 'drag 150px/300ms', dx: 150, ms: 300 },
  { name: 'slow drag 150px/800ms', dx: 150, ms: 800 },
  { name: 'short 14px/80ms', dx: 14, ms: 80 },
  { name: 'short 22px/120ms', dx: 22, ms: 120 },
  { name: 'short 30px/200ms', dx: 30, ms: 200 },
  { name: 'diagonal 70x25/150ms', dx: 70, dy: 25, ms: 150 },
  { name: 'diagonal 50x40/120ms', dx: 50, dy: 40, ms: 120 },
];
const bad = [];
for (const c of cases) {
  for (const dir of [-1, 1, -1, 1]) {
    const from = await ev(`${HELPERS}
      const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && /تفاصيل: /.test(e.getAttribute('aria-label') ?? e.textContent));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: Math.min(Math.max(r.x + r.width / 2, 120), innerWidth - 120), y: r.y + r.height / 2 };`);
    if (!from) {
      log('swipe case skipped, no task visible:', c.name);
      continue;
    }
    const before = await ev(`return ${PAGE};`);
    // Keep the whole stroke on the screen and away from its edges (the edges are the system's
    // back gesture): start where both ends fit.
    const dxs = c.dx * dir;
    from.x = Math.min(Math.max(from.x, 40 + Math.max(0, -dxs)), seen.iw - 40 - Math.max(0, dxs));
    await swipe({ ...c, dx: dxs }, from);
    await sleep(700);
    const focus = adb('shell dumpsys window | grep -m1 mCurrentFocus || true');
    if (!focus.includes(PKG)) {
      log('FAILED: the app is not in front after a swipe:', focus.trim(), '| case', c.name, dir);
      shot('left-the-app');
      process.exit(1);
    }
    const after = await ev(`return ${PAGE};`);
    const opened =
      after.sheets > before.sheets ||
      after.drawers > before.drawers ||
      after.select !== before.select;
    log(
      'swipe',
      c.name,
      dir > 0 ? '→' : '←',
      JSON.stringify({ moved: before.view !== after.view, opened, before, after }),
    );
    if (opened) {
      bad.push(`${c.name} ${dir > 0 ? '→' : '←'}`);
      shot('swipe-' + bad.length);
      await ev(
        `document.querySelector('.backdrop, .drawer-backdrop')?.click(); document.querySelector('.select-bar [aria-label]')?.click();`,
      );
      await sleep(800);
    }
  }
}
log('swipes that opened a task or the selection bar:', JSON.stringify(bad));
if (bad.length) {
  log('FAILED: a swipe between lists was read as a press');
  process.exit(1);
}

// Focus ring: opening a task with a finger and closing its sheet must not leave a square outline
// around the row (the ring is for keyboards; a touch gives none).
{
  const at = await ev(`${HELPERS}
    const b = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length && /تفاصيل: /.test(e.getAttribute('aria-label') ?? e.textContent));
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 };`);
  if (!at) throw new Error('no task to tap for the focus check');
  adb(`shell input tap ${Math.round(origin.x + at.x * sk)} ${Math.round(origin.y + at.y * sk)}`);
  await sleep(1500);
  const opened = await ev(`return document.querySelectorAll('.sheet').length;`);
  await ev(`document.querySelector('.backdrop')?.click();`);
  await sleep(1000);
  shot('focus-after-sheet');
  const ring = await ev(`const a = document.activeElement; const cs = getComputedStyle(a);
    return { tag: a.tagName, label: a.getAttribute('aria-label'), outline: cs.outlineStyle, width: cs.outlineWidth, focusVisible: a.matches(':focus-visible') };`);
  log('focus after closing the sheet:', JSON.stringify({ opened, ...ring }));
  if (opened !== 1) throw new Error('the tap did not open the task');
  if (ring.outline !== 'none' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(ring.tag)) {
    log('FAILED: a focus outline is left around the task after a touch');
    process.exit(1);
  }
}

// Share target (ADR 0048), app running: text shared from another app becomes a task.
await ev(
  `[...document.querySelectorAll('.nav-item')].find((e) => /نواياي/.test(e.textContent))?.click(); await new Promise((r) => setTimeout(r, 600));`,
);
adb(
  `shell am start -n ${PKG}/.MainActivity -a android.intent.action.SEND -t text/plain -e android.intent.extra.SUBJECT TitleWarm -e android.intent.extra.TEXT SharedWarm`,
);
await sleep(3500);
shot('shared-warm');
const sharedWarm = await ev(`return document.body.innerText.includes('SharedWarm');`);
log('text shared while the app was open became a task:', sharedWarm);
if (!sharedWarm) {
  log('FAILED: shared text did not arrive while the app was running');
  process.exit(1);
}

// The «new intention» shortcut on the icon (static shortcut, link nawydo://new): registered with the
// launcher, and opening it while the app runs shows the add sheet.
const shortcuts = adb(`shell dumpsys shortcut ${PKG} || true`);
log('static shortcut registered:', /new_task/.test(shortcuts));
if (!/new_task/.test(shortcuts)) {
  log('FAILED: the «new intention» shortcut is not registered');
  process.exit(1);
}
adb(`shell am start -n ${PKG}/.MainActivity -a android.intent.action.VIEW -d nawydo://new`);
await sleep(3000);
shot('shortcut-warm');
const sheetWarm = await ev(
  `return document.querySelectorAll('.sheet [aria-label="ناوي تعمل إيه؟"], .sheet input').length > 0;`,
);
log('shortcut opened the add sheet while running:', sheetWarm);
if (!sheetWarm) {
  log('FAILED: the shortcut did not open the add sheet');
  process.exit(1);
}
await ev(`document.querySelector('.backdrop')?.click();`);
await sleep(600);

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

// Backup out (ADR 0046): «download» saves a file on the phone (Documents/Nawy) with no share sheet;
// «share» writes it to the app's cache and opens the system share sheet.
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
shot('saved-to-phone');
const docs = adb('shell ls /sdcard/Documents/Nawy || true');
const saved = /nawy-do-.*\.json/.test(docs);
const sheetEarly = /Chooser|Sharesheet|ShareSheet/i.test(adb('shell dumpsys window windows'));
const said = await ev(
  `return document.body.innerText.includes('حفظت النسخة الاحتياطية على الهاتف');`,
);
log(
  'file in Documents/Nawy:',
  saved,
  '| share sheet opened by download:',
  sheetEarly,
  '| said so:',
  said,
);
if (!saved || sheetEarly || !said) {
  log('FAILED: «download backup» must save on the phone, with no share sheet');
  process.exit(1);
}
await ev(`${HELPERS}
  const share = [...document.querySelectorAll('button')].find((b) => b.getClientRects().length > 0 && /مشاركة النسخة/.test(b.textContent));
  if (!share) throw new Error('share button not found');
  share.click(); await wait(3000);`);
shot('share-sheet');
const cache = adb(`shell run-as ${PKG} ls cache`);
const windows = adb('shell dumpsys window windows');
const wrote = /nawy-do-.*\.json/.test(cache);
const chooser = /Chooser|Sharesheet|ShareSheet/i.test(windows);
log('backup file in the app cache:', wrote, '| share sheet on screen:', chooser);
if (!wrote || !chooser) {
  log('FAILED: backup share through the share sheet');
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

// Cold start (the process was ended above): a share, then the icon shortcut, must each start the app
// and not be lost. `check` is evaluated in the page once it is up.
async function coldStart(args, check) {
  adb('shell input keyevent KEYCODE_HOME');
  adb(`shell am force-stop ${PKG}`);
  await sleep(1000);
  adb(`shell am start -n ${PKG}/.MainActivity ${args}`);
  for (let i = 0; i < 12; i += 1) {
    await sleep(2500);
    try {
      const pid = adb(`shell pidof ${PKG} || true`).trim();
      if (!pid) continue;
      adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
      const page = (await (await fetch('http://127.0.0.1:9222/json')).json()).find(
        (t) => t.type === 'page',
      );
      if (!page) continue;
      const sock = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        sock.onopen = res;
        sock.onerror = () => rej(new Error('websocket failed'));
      });
      const value = await new Promise((res) => {
        sock.onmessage = (m) => res(JSON.parse(m.data).result?.result?.value);
        sock.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression: check, returnByValue: true },
          }),
        );
      });
      sock.close();
      if (value === true) return true;
    } catch (e) {
      log('cold start check retry:', String(e).slice(0, 80));
    }
  }
  return false;
}
const coldShare = await coldStart(
  '-a android.intent.action.SEND -t text/plain -e android.intent.extra.TEXT SharedCold',
  `document.body.innerText.includes('SharedCold')`,
);
shot('shared-cold');
log('text shared while the app was closed became a task:', coldShare);
if (!coldShare) {
  log('FAILED: shared text did not arrive on a cold start');
  process.exit(1);
}
const coldNew = await coldStart(
  '-a android.intent.action.VIEW -d nawydo://new',
  `document.querySelectorAll('.sheet input, .sheet [aria-label="ناوي تعمل إيه؟"]').length > 0`,
);
shot('shortcut-cold');
log('shortcut on a cold start opened the add sheet:', coldNew);
if (!coldNew) {
  log('FAILED: the shortcut did not open the add sheet on a cold start');
  process.exit(1);
}
log('OK: sharing and the icon shortcut work, with the app open or closed');
