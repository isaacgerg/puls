#!/usr/bin/env node
// Dashboard smoke test: seed a demo DB, serve it, drive headless Chrome over the
// DevTools protocol and fail on any JavaScript error or missing UI element.
//
// Usage: node scripts/smoke.mjs        (CHROME=/path/to/chrome to override)
// Needs: Node 22+ (built-in WebSocket), PHP with pdo_sqlite, Chrome or Chromium.
// No npm dependencies: this is a dev tool, Puls itself stays dependency-free.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PHP_PORT = 8799;
const CDP_PORT = 9333;
const tmp = mkdtempSync(join(tmpdir(), 'puls-smoke-'));
const dbPath = join(tmp, 'smoke.sqlite');
const children = [];

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME=/path/to/chrome');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function cleanup() {
  await Promise.all(children.map((c) => new Promise((resolve) => {
    if (c.exitCode !== null) return resolve();
    c.once('exit', resolve);
    try { c.kill('SIGKILL'); } catch { resolve(); }
  })));
  // Chrome can still be flushing its profile for a moment after exit
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

async function main() {
  // 1. Seed a demo DB with the old schema; the first request runs every migration on it
  const seed = execFileSync('php', [join(root, 'scripts/seed-demo.php'), dbPath], { encoding: 'utf8' });
  const token = seed.match(/Share token: ([a-f0-9]+)/)?.[1];
  if (!token) throw new Error('Seed did not print a share token');

  // 2. Serve it
  const usersFile = join(tmp, 'users.json');
  execFileSync('php', ['-r', 'file_put_contents($argv[1], json_encode(["smoke" => ["password" => password_hash("smoke-pass", PASSWORD_BCRYPT, ["cost" => 4]), "sites" => []]]));', usersFile]);
  const env = { ...process.env, DB_PATH: dbPath, USERS_FILE: usersFile };
  children.push(spawn('php', ['-S', `localhost:${PHP_PORT}`, '-t', join(root, 'public')], { env, stdio: 'ignore' }));
  const base = `http://localhost:${PHP_PORT}`;
  await waitForHttp(`${base}/?health`);

  // 3. Data for today's features: versioned events (release markers, @version) and a saved breakdown
  const post = (body, ua) => fetch(`${base}/?event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua },
    body: JSON.stringify(body),
  });
  for (let i = 0; i < 3; i++) {
    await post({ event_name: 'cta_click', site: 'demo.example.com', page_path: '/', app_version: '9.9.' + i, event_data: { location: 'smoke' + i } }, `Mozilla/5.0 Smoke/${i}`);
  }
  execFileSync('php', ['-r', `
    $db = new PDO('sqlite:' . $argv[1]);
    $db->exec("INSERT INTO breakdowns (site, label, event_name, group_key, created_at) VALUES ('demo.example.com', 'Smoke card', 'cta_click', 'location', datetime('now'))");
    // A second card, so the logged-in view can arrange them
    $db->exec("INSERT INTO breakdowns (site, label, event_name, group_key, created_at) VALUES ('demo.example.com', 'Versions', 'cta_click', '@version', datetime('now'))");
    // More than five values, so the card offers Show all
    $more = $db->prepare("INSERT INTO events (site, event_name, page_path, event_data, visitor_hash, created_at) VALUES ('demo.example.com', 'cta_click', '/', ?, ?, datetime('now'))");
    for ($i = 0; $i < 6; $i++) $more->execute([json_encode(['location' => 'extra' . $i]), 'extra-' . $i]);
    // Hostile names from the public endpoints must render as text, never as markup or script
    $hostile = 'x"><img src=x onerror="window.__xss=1">' . "');window.__xss=2;('";
    $ev = $db->prepare("INSERT INTO events (site, event_name, page_path, visitor_hash, created_at) VALUES ('demo.example.com', ?, '/', ?, datetime('now'))");
    for ($i = 0; $i < 40; $i++) $ev->execute([$hostile, 'xss-' . $i]);
    $pv = $db->prepare("INSERT INTO pageviews (site, path, visitor_hash, created_at) VALUES ('demo.example.com', ?, ?, datetime('now'))");
    for ($i = 0; $i < 400; $i++) $pv->execute(['/' . $hostile, 'xss-' . $i]);
    // Annotations: a range, a label that needs escaping, and one on the release day (stacked labels)
    $note = $db->prepare("INSERT INTO annotations (site, date, end_date, label, created_at) VALUES ('demo.example.com', ?, ?, ?, datetime('now'))");
    $note->execute([date('Y-m-d', strtotime('-6 days')), date('Y-m-d', strtotime('-4 days')), 'Smoke campaign']);
    $note->execute([date('Y-m-d', strtotime('-2 days')), null, 'Say "hi" <b>bold</b>']);
    $note->execute([date('Y-m-d'), null, 'Smoke film']);
  `, dbPath]);

  // 4. Headless Chrome with remote debugging
  const chrome = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(tmp, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,1900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(chrome);
  let chromeLog = '';
  chrome.stderr.on('data', (d) => { chromeLog = (chromeLog + d).slice(-4000); });
  // A cold Chrome start on a CI runner can take well over five seconds
  try {
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 300);
  } catch (e) {
    throw new Error(`${e.message}\nChrome stderr (tail):\n${chromeLog}`);
  }
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const listeners = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(data.error.message)) : resolve(data.result);
      return;
    }
    if (data.method === 'Runtime.exceptionThrown') {
      const d = data.params.exceptionDetails;
      errors.push(`Exception: ${d.exception?.description || d.text}`);
    }
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push(`console.error: ${data.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    listeners.forEach((l) => l(data));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const loaded = () => new Promise((resolve) => {
    const l = (d) => { if (d.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); resolve(); } };
    listeners.push(l);
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // 5. Load the shared dashboard and walk through it
  const wait = loaded();
  await send('Page.navigate', { url: `${base}/?share=${token}#theme=dark` });
  await wait;

  const steps = async () => {
    const fails = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = (s) => document.querySelector(s);
    const waitFor = async (fn, what, ms = 5000) => {
      for (let t = 0; t < ms; t += 100) { if (fn()) return true; await sleep(100); }
      fails.push(`timed out waiting for ${what}`);
      return false;
    };
    const expect = (cond, what) => { if (!cond) fails.push(what); };

    if (!await waitFor(() => q('#chart-card'), 'pageview chart')) return fails;
    expect(document.querySelectorAll('.stat-card, .card').length > 5, 'dashboard cards render');
    expect(q('#chart-card .chart-release'), 'release marker on pageview chart');
    expect(q('.breakdown-card'), 'saved breakdown card');
    expect(q('.breakdown-card .event-new'), 'NEW badge on breakdown card');

    // Saved card at a glance: count and sparkline, five rows, Show all expands in place
    const bdCard = q('.breakdown-card');
    expect(/^\d+$/.test(bdCard.querySelector('.breakdown-count')?.textContent || '') && bdCard.querySelectorAll('.breakdown-spark rect title').length === 7, 'saved card shows its count and a 7-day sparkline');
    const shownRows = () => [...bdCard.querySelectorAll('.breakdown-rows .trow')].filter((r) => r.offsetParent !== null).length;
    const bdToggle = bdCard.querySelector('.breakdown-toggle');
    expect(bdToggle && shownRows() === 5, 'saved card shows five rows and Show all');
    if (bdToggle) {
      bdToggle.click();
      expect(shownRows() > 5 && bdToggle.getAttribute('aria-expanded') === 'true' && bdToggle.textContent === 'Show fewer', 'Show all expands the card in place');
      bdToggle.click();
      expect(shownRows() === 5, 'Show fewer collapses it again');
    }
    expect(/^\d+(\.\d)?% bounce$/.test(q('[data-panel="entry"] .trow-bounce')?.textContent || ''), 'bounce rate on entry pages');

    // Order: the chart right after the numbers, saved cards after pages and sources
    const isle = (k) => q(`#app [data-island="${k}"]`);
    const order = ['stats', 'chart', 'pages', 'traffic', 'breakdowns', 'bots'].map(isle);
    expect(order.every((el, i) => el && (!i || order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), 'sections in order: numbers, chart, pages, sources, saved cards, bots');

    // Islands: a refresh of the same view keeps unchanged parts as the same DOM, an open drill-down included
    const card = q('.breakdown-card'), chartCard = q('#chart-card');
    q('.breakdown-card .breakdown-open').click();
    await waitFor(() => q('.breakdown-card .event-detail') && q('.breakdown-card .event-detail')._state, 'card drill-down before a refresh');
    const cardDetail = q('.breakdown-card .event-detail');
    q('#sr-status').textContent = '';
    q('.period-btn.active').click();
    await waitFor(() => /Showing/.test(q('#sr-status').textContent), 'refresh of the same view');
    expect(q('.breakdown-card') === card && q('#chart-card') === chartCard, 'unchanged islands keep their DOM across a refresh');
    expect(q('.breakdown-card .event-detail') === cardDetail, 'open drill-down survives a refresh untouched');
    q('.breakdown-card .breakdown-open').click();

    // Hostile event name and path: shown as text, attributes intact, clicking runs no injected code
    const hostile = 'x"><img src=x onerror="window.__xss=1">' + "');window.__xss=2;('";
    expect(!document.querySelector('#app [onerror]'), 'no injected attribute from a hostile name');
    expect([...document.querySelectorAll('.trow-label')].some((l) => l.title === '/' + hostile), 'hostile path kept intact in its title');
    const hostileRow = [...document.querySelectorAll('.trow[data-event]')].find((r) => r.getAttribute('data-event') === hostile);
    expect(hostileRow, 'hostile event name kept intact in data-event');
    if (hostileRow) {
      hostileRow.click();
      await sleep(300);
      document.querySelectorAll('.event-detail').forEach((d) => d.remove());
    }
    expect(window.__xss === undefined, 'no injected script ran');
    const notes = [...document.querySelectorAll('#chart-card .chart-note')];
    expect(notes.length === 3, 'three annotation labels on the pageview chart');
    expect(document.querySelectorAll('#chart-card .chart-col.in-note').length === 3, 'range annotation tints its three days');
    expect(notes.some((n) => n.textContent === 'Say "hi" <b>bold</b>') && !q('#chart-card .chart-note b'), 'annotation label is escaped');
    expect(q('#chart-card .chart-note.stacked') && q('#chart-card .chart-scroll.stacked-marks'), 'annotation and release on one day stack');
    expect(!q('.note-toggle'), 'no + Note button on a shared dashboard');
    expect(!q('.breakdown-grip'), 'no card grip on a shared dashboard');

    // Accessibility: tabs pattern, dialog focus handling
    const tablist = q('.card-tabs[role="tablist"]');
    expect(tablist, 'card tabs are a tablist');
    if (tablist) {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      expect(tabs.length > 1 && tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length === 1, 'exactly one selected tab');
      tabs[0].focus();
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await sleep(50);
      expect(tabs[1].getAttribute('aria-selected') === 'true' && document.activeElement === tabs[1], 'ArrowRight moves to and selects the next tab');
      tabs[0].click();
    }
    expect(!document.querySelector('div[onclick]:not([role]):not([class*="overlay"])'), 'every clickable div has a role');
    const showAllBtn = q('.show-all');
    if (showAllBtn) {
      showAllBtn.focus();
      showAllBtn.click();
      await waitFor(() => q('#overlay.open') && q('.overlay-panel').contains(document.activeElement), 'focus moves into Show all dialog');
      const panel = q('.overlay-panel');
      expect(panel.getAttribute('role') === 'dialog' && panel.getAttribute('aria-modal') === 'true', 'Show all is a modal dialog');
      const close = q('.overlay-close');
      close.focus();
      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(panel.contains(document.activeElement), 'Tab stays inside the dialog');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(50);
      expect(!q('#overlay.open') && document.activeElement === showAllBtn, 'Escape closes and returns focus');
    }

    // Event drill-down
    q('.card-tab[data-tab="events"]').click();
    const row = q('.trow[data-event="cta_click"]');
    expect(row, 'cta_click row in Events tab');
    if (!row) return fails;
    expect(row.getAttribute('role') === 'button' && row.tabIndex === 0, 'event row is a keyboard button');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (!await waitFor(() => q('.event-detail') && q('.event-detail')._state, 'event drill-down opened with Enter')) return fails;
    expect(q('.event-detail .event-summary'), 'drill-down summary');
    expect(q('.event-detail .event-chart .chart-bar'), 'drill-down trend bars');
    expect(q('.event-detail .event-chip[data-key="@version"]'), 'version group chip');
    expect(q('.event-detail .event-csv'), 'CSV link');

    // Group by version
    q('.event-detail .event-chip[data-key="@version"]').click();
    await waitFor(() => q('.event-detail')._state && q('.event-detail')._state.data.eventGroupKey === '@version', 'group by version');
    expect(document.querySelectorAll('.event-detail .trow').length >= 3, 'version values listed');

    // Funnel
    const input = q('.event-detail input.event-select');
    const options = input && input.list ? input.list.options : [];
    expect(options.length > 0, 'funnel picker suggests events');
    // An event never seen still gives a funnel (0 converted) instead of an error
    input.value = 'never_seen_event';
    input.dispatchEvent(new Event('change'));
    await waitFor(() => q('.event-detail .event-funnel') && q('.event-detail')._state.then === 'never_seen_event', 'funnel to an unseen event');
    const again = q('.event-detail input.event-select');
    again.value = options[0].value;
    again.dispatchEvent(new Event('change'));
    await waitFor(() => q('.event-detail .event-funnel') && q('.event-detail')._state.then === options[0].value, 'funnel result');

    // Compare mode follows into the drill-down
    const cmp = q('.chart-compare-toggle');
    if (cmp) {
      cmp.click();
      await waitFor(() => q('.event-detail .event-chart.compare') || !q('.chart-compare-toggle.active'), 'compare overlay in drill-down');
    }

    // Long period: panel survives the reload and the chart turns dense
    q('#sr-status').textContent = '';
    q('.period-btn[data-days="90"]').click();
    await waitFor(() => /last 90 days/.test(q('#sr-status').textContent), 'screen reader status announces the period change');
    await waitFor(() => q('.event-detail .event-chart.dense'), 'dense 90-day chart with panel still open', 8000);
    // A long period scrolls the pageview chart; it opens on the latest days, not the oldest
    const mainScroll = q('#chart-card .chart-scroll');
    expect(mainScroll.scrollWidth > mainScroll.clientWidth, '90-day pageview chart is wider than the card');
    expect(mainScroll.scrollLeft + mainScroll.clientWidth >= mainScroll.scrollWidth - 1, 'pageview chart opens scrolled to the latest day');
    expect(q('.event-detail') && q('.event-detail')._state && q('.event-detail')._state.then, 'funnel choice kept across period change');

    // Breakdown card opens the same drill-down inside the card, grouped on its key
    const open = q('.breakdown-card .breakdown-open');
    expect(open, 'Details button on breakdown card');
    if (open) {
      open.click();
      await waitFor(() => q('.breakdown-card .event-detail') && q('.breakdown-card .event-detail')._state, 'drill-down inside breakdown card');
      expect(q('.breakdown-card .event-detail')._state.data.eventGroupKey === 'location', 'card drill-down grouped on the card key');
      expect(q('.breakdown-card .breakdown-open').getAttribute('aria-expanded') === 'true', 'Details button reports expanded');
      q('.period-btn[data-days="30"]').click();
      await waitFor(() => q('.breakdown-card .event-detail') && q('.breakdown-card .event-detail')._state && q('.breakdown-card .event-detail')._state.data.days === 30, 'card drill-down kept across period change', 8000);
    }

    // Light theme renders too
    document.documentElement.setAttribute('data-theme', 'light');
    expect(getComputedStyle(document.body).backgroundColor !== '', 'light theme applies');
    return fails;
  };

  const result = await send('Runtime.evaluate', {
    expression: `(${steps.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) errors.push(`Smoke steps threw: ${result.exceptionDetails.exception?.description}`);
  const failures = [...(result.result?.value || [])];

  // 6. Logged in: a goal can be added for an event that has not happened yet
  const wait2 = loaded();
  await send('Page.navigate', { url: `${base}/` });
  await wait2;
  const wait3 = loaded();
  await send('Runtime.evaluate', { expression: `document.getElementById('username').value='smoke'; document.getElementById('password').value='smoke-pass'; document.querySelector('form[action="/?login"]').submit();` });
  await wait3;
  const loggedIn = async () => {
    const fails = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = (s) => document.querySelector(s);
    const waitFor = async (fn, what, ms = 5000) => {
      for (let t = 0; t < ms; t += 100) { if (fn()) return true; await sleep(100); }
      fails.push(`timed out waiting for ${what}`);
      return false;
    };
    if (!await waitFor(() => q('#chart-card') && q('#goal-search'), 'logged-in dashboard')) return fails;
    const search = q('#goal-search');
    search.value = 'pwa_install';
    search.dispatchEvent(new Event('input'));
    const add = q('#goal-list .goal-item-new');
    if (!add || add.getAttribute('data-type') !== 'event') { fails.push('goal picker offers an unseen event'); return fails; }
    add.click();
    await waitFor(() => [...document.querySelectorAll('.goal-row')].some((r) => r.textContent.includes('pwa_install') && r.textContent.includes('No hits yet')), 'unseen event goal shows No hits yet', 8000);
    if (q('.menu-close').getAttribute('aria-label') !== 'Close settings') fails.push('settings close button is labelled');

    // Arranging saved cards: arrow keys on the grip, then dragging it back; the order is saved
    const titles = () => [...document.querySelectorAll('.breakdown-card .card-title')].map((t) => t.textContent);
    const savedTitles = async () => (await (await fetch('/?api&days=7&site=demo.example.com')).json()).breakdowns.map((b) => b.label);
    const waitSaved = async (want) => {
      for (let t = 0; t < 30; t++) { if ((await savedTitles()).join() === want.join()) return true; await sleep(100); }
      return false;
    };
    const start = titles();
    const grip = q('.breakdown-card .breakdown-grip');
    if (!grip || start.length < 2) { fails.push('a grip on each saved card'); return fails; }
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const moved = [start[1], start[0], ...start.slice(2)];
    if (titles().join() !== moved.join() || document.activeElement !== grip) fails.push('an arrow key moves the card and keeps focus on its grip');
    if (!await waitSaved(moved)) fails.push('the new card order is saved');
    const dragGrip = [...document.querySelectorAll('.breakdown-card')].find((c) => c.querySelector('.card-title').textContent === start[0]).querySelector('.breakdown-grip');
    const target = [...document.querySelectorAll('.breakdown-card')].find((c) => c.querySelector('.card-title').textContent === start[1]);
    target.scrollIntoView({ block: 'center' });
    const box = target.getBoundingClientRect(), from = dragGrip.getBoundingClientRect();
    dragGrip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: from.x + 5, clientY: from.y + 5 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    if (titles().join() !== start.join()) fails.push('dragging the grip onto another card moves it there');
    if (!await waitSaved(start)) fails.push('the dragged order is saved');

    // Removing a card or goal waits behind an Undo toast; leaving the page sends it
    const toast = q('#toast');
    const cardCount = document.querySelectorAll('.breakdown-card').length;
    q('.breakdown-card .goal-remove').click();
    if (document.querySelectorAll('.breakdown-card').length !== cardCount - 1 || toast.hidden || !/Card removed/.test(toast.textContent)) fails.push('removing a card hides it and shows the Undo toast');
    q('#toast-undo').click();
    if (document.querySelectorAll('.breakdown-card').length !== cardCount || !toast.hidden) fails.push('Undo brings the card back');
    const goalCount = document.querySelectorAll('.goal-row').length;
    q('.goal-row .goal-remove').click();
    if (document.querySelectorAll('.goal-row').length !== goalCount - 1 || !/Goal removed/.test(toast.textContent)) fails.push('removing a goal hides it behind the Undo toast');
    q('#toast-undo').click();
    if (document.querySelectorAll('.goal-row').length !== goalCount) fails.push('Undo brings the goal back');
    q('.breakdown-card .goal-remove').click();
    window.dispatchEvent(new Event('pagehide'));
    let removed = false;
    for (let t = 0; t < 30 && !removed; t++) {
      await sleep(100);
      removed = (await savedTitles()).length === cardCount - 1;
    }
    if (!removed) fails.push('a waiting removal is sent when the page is left');

    // Annotations: + Note creates, Settings relabels and removes
    window.closeMenu();
    const toggle = q('.note-toggle');
    if (!toggle) { fails.push('+ Note button on the chart'); return fails; }
    toggle.click();
    const form = q('#note-form');
    if (form.hidden || document.activeElement !== form.elements.label) fails.push('+ Note opens the form and focuses the text');
    form.elements.label.value = 'Smoke note';
    form.requestSubmit();
    await waitFor(() => [...document.querySelectorAll('#chart-card .chart-note')].some((n) => /Smoke note/.test(n.title)), 'new note on the chart', 8000);
    window.openMenu();
    const item = [...document.querySelectorAll('#note-list .note-item')].find((i) => i.querySelector('input').value === 'Smoke note');
    if (!item) { fails.push('note listed in Settings'); return fails; }
    const field = item.querySelector('input');
    field.value = 'Smoke note, clarified';
    field.dispatchEvent(new Event('change'));
    await waitFor(() => [...document.querySelectorAll('#chart-card .chart-note')].some((n) => /Smoke note, clarified/.test(n.title)), 'relabelled note on the chart', 8000);
    item.querySelector('button').click();
    await waitFor(() => ![...document.querySelectorAll('#chart-card .chart-note')].some((n) => /Smoke note/.test(n.title)), 'removed note leaves the chart', 8000);
    window.closeMenu();
    q('.note-toggle').click();
    q('.note-form-hint button').click();
    if (!q('#note-form').hidden || !q('#menu-panel').classList.contains('open')) fails.push('note form hint closes the form and opens Settings');
    return fails;
  };
  const result2 = await send('Runtime.evaluate', { expression: `(${loggedIn.toString()})()`, awaitPromise: true, returnByValue: true });
  if (result2.exceptionDetails) errors.push(`Logged-in steps threw: ${result2.exceptionDetails.exception?.description}`);
  failures.push(...(result2.result?.value || []));

  ws.close();
  failures.push(...errors);
  if (failures.length) {
    console.error(`Dashboard smoke test FAILED (${failures.length}):`);
    failures.forEach((f) => console.error('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('Dashboard smoke test passed: load, section order, islands kept across a refresh, release markers, breakdown card (count, sparkline, Show all) and its details, arranging cards (keys, drag), undo for card and goal removal, hostile names render as text, entry page bounce, annotations (shared view, add, relabel, remove), keyboard drill-down, group by version, funnel incl. unseen event, compare, 90 days, light theme, logged-in goal for an unseen event, tabs pattern, dialog focus trap, status announcements. No JS errors.');
  }
}

main()
  .catch((e) => { console.error('Smoke test error:', e.message); process.exitCode = 1; })
  .finally(cleanup);
