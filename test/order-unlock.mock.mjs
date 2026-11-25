// Mocked browser checks for family order unlock. No live orders or issued codes.
// Run: NODE_PATH=/tmp/pw-family/node_modules node test/order-unlock.mock.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}/`;
const ORDER_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const LEGACY_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const ORDER_ID = 'P847362915028374651';
const OTHER_ID = 'P902847163550274819';
const CODE = 'FO2K7M';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStore() {
  return {
    orders: new Map(),
    codes: new Map(),
    hits: [],
    bad: [],
    mode: 'ok',
    hangPosts: 0
  };
}

function orderJson(row, orderId) {
  const max = row.max || 3;
  return {
    ok: true,
    remaining: Math.max(0, max - row.uses),
    max,
    uses: row.uses,
    quiz: row.quiz,
    orderId,
    bound: true,
    paidVerified: false
  };
}

async function fulfill(route, status, json) {
  try {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(json)
    });
  } catch (e) {}
}

async function handle(route, store) {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(BASE)) return route.continue();
  let parsed;
  try { parsed = new URL(url); } catch (e) {
    store.bad.push({ url, reason: 'bad-url' });
    return fulfill(route, 599, { ok: false, error: 'unexpected' });
  }
  const hit = {
    method: req.method(),
    host: parsed.host,
    path: parsed.pathname,
    search: parsed.search,
    body: req.postData() || '',
    headers: req.headers()
  };
  store.hits.push(hit);
  const quizFromBody = () => {
    try { return JSON.parse(hit.body || '{}'); } catch (e) { return {}; }
  };
  if (parsed.host === ORDER_HOST && parsed.pathname === '/order/get' && req.method() === 'GET') {
    const quiz = parsed.searchParams.get('quiz');
    const orderId = parsed.searchParams.get('orderId');
    if (quiz !== 'family') store.bad.push({ ...hit, reason: 'quiz' });
    if (store.mode === 'down') return fulfill(route, 500, { ok: false, error: 'down' });
    const row = store.orders.get(orderId);
    if (!row) return fulfill(route, 404, { ok: false, error: 'not_found' });
    if (row.quiz !== 'family') return fulfill(route, 403, { ok: false, error: 'bound_other_quiz' });
    return fulfill(route, 200, orderJson(row, orderId));
  }
  if (parsed.host === ORDER_HOST && parsed.pathname === '/order/redeem' && req.method() === 'POST') {
    const body = quizFromBody();
    if (body.quiz !== 'family') store.bad.push({ ...hit, reason: 'quiz' });
    if (store.mode === 'down') return fulfill(route, 500, { ok: false, error: 'down' });
    if (store.mode === 'hang-charge') {
      store.hangPosts += 1;
      if (store.hangPosts === 1) {
        const row = store.orders.get(body.orderId) || { quiz: 'family', uses: 0, max: 3 };
        if (row.quiz === 'family' && row.uses < 3) row.uses += 1;
        row.quiz = row.quiz || 'family';
        store.orders.set(body.orderId, row);
        await delay(1600);
        return fulfill(route, 200, orderJson(row, body.orderId));
      }
    }
    if (store.mode === 'hang-nochg') {
      store.hangPosts += 1;
      if (store.hangPosts === 1) {
        await delay(1600);
        try {
          await route.fulfill({ status: 504, contentType: 'text/plain', body: '' });
        } catch (e) {}
        return;
      }
    }
    const row = store.orders.get(body.orderId);
    if (row && row.quiz !== 'family') return fulfill(route, 403, { ok: false, error: 'bound_other_quiz' });
    const current = row || { quiz: 'family', uses: 0, max: 3 };
    if (store.mode === 'post-exhausted' || current.uses >= 3) {
      return fulfill(route, 403, { ok: false, error: 'exhausted', remaining: 0, max: 3 });
    }
    current.uses += 1;
    current.quiz = 'family';
    store.orders.set(body.orderId, current);
    return fulfill(route, 200, orderJson(current, body.orderId));
  }
  if (parsed.host === LEGACY_HOST && parsed.pathname === '/redeem' && req.method() === 'POST') {
    const body = quizFromBody();
    if (body.quiz !== 'family') store.bad.push({ ...hit, reason: 'quiz' });
    const row = store.codes.get(body.code);
    if (!row) return fulfill(route, 404, { ok: false, error: 'not_found' });
    if (row.remaining <= 0) return fulfill(route, 403, { ok: false, error: 'exhausted' });
    row.remaining -= 1;
    return fulfill(route, 200, { ok: true, remaining: row.remaining, max: row.max || 3 });
  }
  if (parsed.host === LEGACY_HOST && parsed.pathname === '/get' && req.method() === 'GET') {
    const quiz = parsed.searchParams.get('quiz');
    const code = parsed.searchParams.get('code');
    if (quiz !== 'family') store.bad.push({ ...hit, reason: 'quiz' });
    const row = store.codes.get(code);
    if (!row) return fulfill(route, 404, { ok: false, error: 'not_found' });
    return fulfill(route, 200, { ok: true, remaining: row.remaining, max: row.max || 3 });
  }
  store.bad.push({ ...hit, reason: 'unexpected-route' });
  return fulfill(route, 599, { ok: false, error: 'unexpected' });
}

async function openPage(browser, opts = {}) {
  const width = opts.width || 390;
  const height = opts.height || 844;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    globalThis.__ORDER_TIMEOUT_MS = 500;
    globalThis.__ORDER_RECONCILE_MS = 0;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const store = createStore();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.route('**/*', (route) => handle(route, store));
  const target = new URL(opts.path || '/', BASE).toString();
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  return { context, page, store, errors };
}

function posts(store, pathname, host) {
  return store.hits.filter((h) => h.method === 'POST' && h.path === pathname && h.host === host);
}
function since(store, n) {
  return store.hits.slice(n);
}
function usesOf(store, id = ORDER_ID) {
  return store.orders.get(id) ? store.orders.get(id).uses : 0;
}
function assertClean(store, errors) {
  assert(store.bad.length === 0, 'bad requests ' + JSON.stringify(store.bad));
  assert(errors.length === 0, 'page errors ' + errors.join('\n'));
}

async function answerN(page, n) {
  for (let i = 0; i < n; i++) {
    const prog = (await page.locator('#qprog').innerText()).trim();
    await page.locator('#opts .opt').first().click();
    await page.waitForFunction((prev) => {
      const el = document.querySelector('#qprog');
      return !!(el && el.textContent.trim() !== prev);
    }, prog);
  }
}

async function answerProgress(page) {
  for (let i = 0; i < 18; i++) {
    if (await page.locator('#result.active').count()) return;
    const prog = (await page.locator('#qprog').innerText()).trim();
    await page.locator('#opts .opt').first().click();
    await page.waitForFunction((prev) => {
      if (document.querySelector('#result.active')) return true;
      const el = document.querySelector('#qprog');
      return !!(el && el.textContent.trim() !== prev);
    }, prog);
  }
  await page.locator('#result.active').waitFor();
}

async function submitOrder(page, raw) {
  await page.locator('#btnStart').click();
  await page.locator('#codeMask.show').waitFor();
  await page.locator('#codeInput').fill(raw);
  await page.locator('#btnCodeOk').click();
}

async function testFlow(browser) {
  const { page, store, context, errors } = await openPage(browser);
  await submitOrder(page, 'P 8473 6291 5028 3746 51');
  await page.locator('#quiz.active').waitFor();
  assert((await page.locator('#qprog').innerText()).includes('/ 18'), 'quiz length changed');
  assert(usesOf(store) === 1, 'first attempt should deduct once, uses=' + usesOf(store));
  assert(posts(store, '/order/redeem', ORDER_HOST).length === 1, 'first redeem count');
  const redeem = posts(store, '/order/redeem', ORDER_HOST)[0];
  const body = JSON.parse(redeem.body);
  assert(body.quiz === 'family' && body.orderId === ORDER_ID, 'redeem body ' + redeem.body);
  assert(!('code' in body), 'order redeem must not send a code');
  assert(redeem.headers['x-device-id'], 'order redeem missing device id');
  assert(store.hits.every((h) => h.host === ORDER_HOST), 'first attempt touched legacy host');
  await answerN(page, 2);
  const qtext = await page.locator('#qtext').innerText();
  const qprog = (await page.locator('#qprog').innerText()).trim();
  assert(qprog.startsWith('3'), 'expected question 3, got ' + qprog);
  let mark = store.hits.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#quiz.active').waitFor();
  assert((await page.locator('#qtext').innerText()) === qtext, 'mid-quiz refresh changed the question');
  assert((await page.locator('#qprog').innerText()).trim() === qprog, 'mid-quiz refresh changed progress');
  let extra = since(store, mark);
  assert(extra.length >= 1 && extra.every((h) => h.method === 'GET' && h.path === '/order/get'), 'mid refresh not peek-only ' + JSON.stringify(extra));
  assert(usesOf(store) === 1, 'mid refresh deducted');

  await page.evaluate(() => show('start'));
  await page.locator('#start.active').waitFor();
  assert((await page.locator('#btnStart').innerText()).trim() === '继续答题', 'continue label');
  mark = store.hits.length;
  await page.locator('#btnStart').click();
  await page.locator('#quiz.active').waitFor();
  await page.waitForFunction((expected) => document.querySelector('#qtext').textContent === expected, qtext);
  extra = since(store, mark);
  assert(extra.length >= 1 && extra.every((h) => h.method === 'GET' && h.path === '/order/get'), 'continue not peek-only ' + JSON.stringify(extra));
  assert(usesOf(store) === 1, 'continue deducted');

  await answerProgress(page);
  const index = (await page.locator('.index-num').innerText()).trim();
  const title = (await page.locator('#typeTitle').innerText()).trim();
  mark = store.hits.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#result.active').waitFor();
  assert((await page.locator('.index-num').innerText()).trim() === index, 'result refresh changed the index');
  assert((await page.locator('#typeTitle').innerText()).trim() === title, 'result refresh changed the title');
  extra = since(store, mark);
  assert(extra.every((h) => h.method === 'GET' && h.path === '/order/get'), 'result refresh not peek-only ' + JSON.stringify(extra));
  assert(usesOf(store) === 1, 'result refresh deducted');
  const shown = await page.locator('body').innerText();
  assert(!shown.includes('paidVerified') && !shown.includes('付款'), 'payment wording on result');

  mark = store.hits.length;
  await page.locator('#btnRetry').click();
  await page.locator('#quiz.active').waitFor();
  assert(usesOf(store) === 2, 'retest should deduct a second time');
  extra = since(store, mark);
  assert(extra.filter((h) => h.method === 'POST' && h.path === '/order/redeem').length === 1, 'retest redeem count');
  assert((await page.locator('#qprog').innerText()).trim().startsWith('1'), 'retest did not start over');

  await answerProgress(page);
  const keptTitle = (await page.locator('#typeTitle').innerText()).trim();
  const keptIndex = (await page.locator('.index-num').innerText()).trim();
  store.orders.get(ORDER_ID).uses = 3;
  mark = store.hits.length;
  await page.locator('#btnRetry').click();
  await page.locator('#toast.show').waitFor();
  const toast = await page.locator('#toast').innerText();
  assert(toast.includes('3 次'), '4th toast: ' + toast);
  assert(await page.locator('#result.active').count() === 1, '4th left the result');
  assert((await page.locator('#typeTitle').innerText()).trim() === keptTitle, '4th cleared the title');
  assert((await page.locator('.index-num').innerText()).trim() === keptIndex, '4th cleared the index');
  extra = since(store, mark);
  assert(!extra.some((h) => h.method === 'POST'), '4th issued a redeem ' + JSON.stringify(extra));
  assert(usesOf(store) === 3, '4th changed uses');
  assertClean(store, errors);
  await context.close();
}

async function testLastUseStillPeeks(browser) {
  const { page, store, context, errors } = await openPage(browser);
  await submitOrder(page, ORDER_ID);
  await page.locator('#quiz.active').waitFor();
  await answerN(page, 1);
  const qtext = await page.locator('#qtext').innerText();
  store.orders.get(ORDER_ID).uses = 3;
  let mark = store.hits.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#quiz.active').waitFor();
  assert((await page.locator('#qtext').innerText()) === qtext, 'last-use refresh left the question');
  let extra = since(store, mark);
  assert(extra.every((h) => h.method === 'GET' && h.path === '/order/get'), 'last-use refresh redeemed ' + JSON.stringify(extra));
  assert(usesOf(store) === 3, 'last-use refresh changed uses');
  await answerProgress(page);
  const title = (await page.locator('#typeTitle').innerText()).trim();
  mark = store.hits.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#result.active').waitFor();
  assert((await page.locator('#typeTitle').innerText()).trim() === title, 'last-use result refresh dropped the result');
  extra = since(store, mark);
  assert(extra.every((h) => h.method === 'GET' && h.path === '/order/get'), 'last-use result refresh redeemed ' + JSON.stringify(extra));
  assert(usesOf(store) === 3, 'last-use result refresh changed uses');
  assertClean(store, errors);
  await context.close();
}

async function testPostExhaustedKeepsResult(browser) {
  const { page, store, context, errors } = await openPage(browser);
  await submitOrder(page, ORDER_ID);
  await page.locator('#quiz.active').waitFor();
  await answerProgress(page);
  const title = (await page.locator('#typeTitle').innerText()).trim();
  store.mode = 'post-exhausted';
  await page.locator('#btnRetry').click();
  await page.locator('#toast.show').waitFor();
  assert((await page.locator('#toast').innerText()).includes('3 次'), await page.locator('#toast').innerText());
  assert(await page.locator('#result.active').count() === 1, 'rejected redeem left the result');
  assert((await page.locator('#typeTitle').innerText()).trim() === title, 'rejected redeem cleared the result');
  assert(usesOf(store) === 1, 'rejected redeem still incremented');
  assertClean(store, errors);
  await context.close();
}

async function testWrongBinding(browser) {
  const { page, store, context, errors } = await openPage(browser);
  store.orders.set(OTHER_ID, { quiz: 'bazi', uses: 1, max: 3 });
  await page.evaluate(() => {
    localStorage.setItem('family_last_result', JSON.stringify({
      tierId: 'ROOT', name: '根系半稳 · 能站也能晃', index: 50, dominant: 'E', punch: 'x', at: 1,
      E: 50, B: 50, C: 50, R: 50, W: 50, S: 50
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await submitOrder(page, OTHER_ID);
  await page.locator('#toast.show').waitFor();
  assert((await page.locator('#toast').innerText()).includes('别的测试'), await page.locator('#toast').innerText());
  assert(await page.locator('#quiz.active').count() === 0, 'wrong binding opened the quiz');
  assert(posts(store, '/order/redeem', ORDER_HOST).length === 0, 'wrong binding redeemed');
  assert(store.orders.get(OTHER_ID).uses === 1, 'wrong binding changed uses');
  await page.locator('#codeClose').click();
  await page.locator('#btnLast').click();
  await page.locator('#result.active').waitFor();
  assert((await page.locator('.index-num').innerText()).trim() === '50', 'local last result changed');
  assert(posts(store, '/order/redeem', ORDER_HOST).length === 0, 'view last redeemed');
  assert(posts(store, '/redeem', LEGACY_HOST).length === 0, 'view last used a code');
  assertClean(store, errors);
  await context.close();
}

async function testNotFoundHidesResult(browser) {
  const { page, store, context, errors } = await openPage(browser);
  await submitOrder(page, ORDER_ID);
  await page.locator('#quiz.active').waitFor();
  await answerProgress(page);
  store.orders.delete(ORDER_ID);
  const mark = store.hits.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#start.active').waitFor();
  await page.waitForTimeout(400);
  assert(await page.locator('#result.active').count() === 0, 'not_found still showed the result');
  const extra = since(store, mark);
  assert(extra.every((h) => h.method === 'GET'), 'not_found refresh redeemed ' + JSON.stringify(extra));
  assert((await page.locator('#btnStart').innerText()).trim() === '开始测试', 'not_found kept the order session');
  assertClean(store, errors);
  await context.close();
}

async function testTimeouts(browser) {
  const accept = await openPage(browser);
  accept.store.mode = 'hang-charge';
  await submitOrder(accept.page, ORDER_ID);
  await accept.page.locator('#quiz.active').waitFor();
  assert(usesOf(accept.store) === 1, 'timeout accept uses ' + usesOf(accept.store));
  assert(posts(accept.store, '/order/redeem', ORDER_HOST).length === 1, 'timeout accept retried redeem');
  assertClean(accept.store, accept.errors);
  await accept.context.close();

  const retry = await openPage(browser);
  retry.store.mode = 'hang-nochg';
  await submitOrder(retry.page, ORDER_ID);
  await retry.page.locator('#quiz.active').waitFor();
  assert(usesOf(retry.store) === 1, 'timeout retry uses ' + usesOf(retry.store));
  assert(posts(retry.store, '/order/redeem', ORDER_HOST).length === 2, 'timeout retry did not post again after an unchanged peek');
  assertClean(retry.store, retry.errors);
  await retry.context.close();

  const give = await openPage(browser);
  give.store.mode = 'down';
  await submitOrder(give.page, ORDER_ID);
  await give.page.locator('#toast.show').waitFor();
  assert((await give.page.locator('#toast').innerText()).includes('暂时验证不了'), await give.page.locator('#toast').innerText());
  assert(await give.page.locator('#quiz.active').count() === 0, 'timeout giveup opened the quiz');
  assert(posts(give.store, '/order/redeem', ORDER_HOST).length === 1, 'timeout giveup redeem count');
  assert(usesOf(give.store) === 0, 'timeout giveup stored a use');
  assertClean(give.store, give.errors);
  await give.context.close();
}

async function testLegacy(browser) {
  const { page, store, context, errors } = await openPage(browser);
  store.codes.set(CODE, { remaining: 3, max: 3 });
  await submitOrder(page, 'fo2k7m');
  await page.locator('#quiz.active').waitFor();
  const redeem = posts(store, '/redeem', LEGACY_HOST);
  assert(redeem.length === 1, 'legacy redeem count ' + JSON.stringify(store.hits));
  const body = JSON.parse(redeem[0].body);
  assert(body.quiz === 'family' && body.code === CODE, 'legacy body ' + redeem[0].body);
  assert(!redeem[0].headers['x-device-id'], 'legacy redeem should keep the original headers');
  assert(store.hits.every((h) => h.host === LEGACY_HOST), 'legacy code hit the order host');
  assert(store.codes.get(CODE).remaining === 2, 'legacy remaining');
  const mark = store.hits.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#start.active').waitFor();
  assert(store.hits.length === mark, 'legacy refresh called the api');
  assert((await page.locator('#btnStart').innerText()).trim() === '已解锁，直接进入', 'legacy continue label');
  await page.locator('#btnStart').click();
  await page.locator('#quiz.active').waitFor();
  assert(store.hits.length === mark, 'legacy continue deducted');
  await page.evaluate((code) => peekVault(code), CODE);
  const get = store.hits.slice(mark).filter((h) => h.method === 'GET');
  assert(get.length === 1 && get[0].host === LEGACY_HOST && get[0].path === '/get', 'legacy peek path ' + JSON.stringify(get));
  assert(get[0].search.includes('quiz=family') && get[0].search.includes('code=' + CODE), get[0].search);
  assertClean(store, errors);
  await context.close();

  const gone = await openPage(browser);
  gone.store.codes.set(CODE, { remaining: 0, max: 3 });
  await submitOrder(gone.page, CODE);
  await gone.page.locator('#toast.show').waitFor();
  assert((await gone.page.locator('#toast').innerText()).includes('用完'), await gone.page.locator('#toast').innerText());
  assert(await gone.page.locator('#quiz.active').count() === 0, 'exhausted code opened the quiz');
  assert(gone.store.codes.get(CODE).remaining === 0, 'exhausted code decremented');
  assertClean(gone.store, gone.errors);
  await gone.context.close();
}

async function testInvalidAndUrl(browser) {
  const url = await openPage(browser, { path: '/?code=fo2k7m' });
  await url.page.locator('#codeMask.show').waitFor();
  assert((await url.page.locator('#codeInput').inputValue()) === CODE, 'url code was not kept');
  assert(url.store.hits.length === 0, 'url code auto-submitted');
  const hint = await url.page.locator('#codeMask').innerText();
  assert(hint.includes('我的订单') && hint.includes('3 次'), hint);
  assert(!hint.includes('验证码'), 'url modal advertises codes');
  assertClean(url.store, url.errors);
  await url.context.close();

  const bad = await openPage(browser);
  const samples = ['P111111111111111111', 'P123456789012345678', 'P1234567890', '随便写'];
  for (const sample of samples) {
    const before = bad.store.hits.length;
    await bad.page.locator('#btnStart').click();
    await bad.page.locator('#codeInput').fill(sample);
    await bad.page.locator('#btnCodeOk').click();
    await bad.page.locator('#toast.show').waitFor();
    assert((await bad.page.locator('#toast').innerText()).includes('订单号格式不对'), sample + ' ' + await bad.page.locator('#toast').innerText());
    assert(bad.store.hits.length === before, sample + ' called the api');
    await bad.page.locator('#codeClose').click();
    await bad.page.waitForTimeout(300);
  }
  assertClean(bad.store, bad.errors);
  await bad.context.close();

  const wide = await openPage(browser);
  await submitOrder(wide.page, '「' + ORDER_ID + '」');
  await wide.page.locator('#quiz.active').waitFor();
  assert(usesOf(wide.store) === 1, 'quoted order did not redeem');
  assertClean(wide.store, wide.errors);
  await wide.context.close();
}

async function testViewports(browser) {
  for (const width of [320, 390]) {
    const height = width === 320 ? 568 : 844;
    const { page, store, context, errors } = await openPage(browser, { width, height });
    const disc = await page.locator('#startDisclaimer').innerText();
    assert(disc.includes('非正式心理测量') && disc.includes('不能替代专业心理咨询'), 'disclaimer missing at ' + width);
    await page.locator('#btnStart').click();
    await page.locator('#codeMask.show').waitFor();
    const modal = await page.locator('#codeMask').innerText();
    assert(modal.includes('订单号') && modal.includes('我的订单') && modal.includes('3 次'), modal);
    assert(!modal.includes('验证码') && !modal.includes('付款'), 'modal copy at ' + width + ': ' + modal);
    const input = await page.locator('#codeInput').boundingBox();
    const button = await page.locator('#btnCodeOk').boundingBox();
    const hint = await page.locator('.code-hint').boundingBox();
    assert(input && input.x >= 0 && input.x + input.width <= width + 1, 'input overflow ' + width);
    assert(button && button.y + button.height <= height + 1 && button.x >= 0, 'button clipped ' + width);
    assert(hint && hint.y + hint.height <= height + 1, 'hint clipped ' + width);
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth
    }));
    assert(overflow.sw <= overflow.cw + 1, 'modal overflow ' + width + ' ' + JSON.stringify(overflow));
    await page.screenshot({ path: `/tmp/family-order-${width}.png` });
    await page.locator('#codeInput').fill(ORDER_ID);
    await page.locator('#btnCodeOk').click();
    await page.locator('#quiz.active').waitFor();
    const quizOverflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth
    }));
    assert(quizOverflow.sw <= quizOverflow.cw + 1, 'quiz overflow ' + width + ' ' + JSON.stringify(quizOverflow));
    await answerProgress(page);
    const resultOverflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth
    }));
    assert(resultOverflow.sw <= resultOverflow.cw + 1, 'result overflow ' + width + ' ' + JSON.stringify(resultOverflow));
    assert((await page.locator('body').innerText()).includes('非正式心理测量'), 'result disclaimer missing');
    await page.screenshot({ path: `/tmp/family-result-${width}.png` });
    assertClean(store, errors);
    await context.close();
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', BASE);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const full = path.normalize(path.join(ROOT, rel));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      const type = full.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const tests = [
  ['flow', testFlow],
  ['last-use-peek', testLastUseStillPeeks],
  ['post-exhausted', testPostExhaustedKeepsResult],
  ['wrong-binding', testWrongBinding],
  ['not-found', testNotFoundHidesResult],
  ['timeouts', testTimeouts],
  ['legacy', testLegacy],
  ['invalid-url', testInvalidAndUrl],
  ['viewports', testViewports]
];

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failed = [];
  for (const [name, fn] of tests) {
    try {
      await fn(browser);
      console.log('PASS', name);
    } catch (e) {
      failed.push(name + ': ' + (e && e.stack ? e.stack : e));
      console.error('FAIL', name, e);
    }
  }
  if (failed.length) {
    console.error(failed.join('\n\n'));
    process.exitCode = 1;
  } else {
    console.log('ALL_PASS', tests.length);
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
