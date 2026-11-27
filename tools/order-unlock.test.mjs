// Mocked browser checks for family order unlock. Synthetic ids only.
// Chrome pins the vault, the old order host, and mantledb.sh to 127.0.0.1
// so a missed mock cannot redeem a real code.
// Run: node tools/order-unlock.test.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ORDER_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const VAULT_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const ORDER = 'P847362915028374651';
const OTHER = 'P902847163550274819';
const CODE = 'FO2K7M';
const P19 = 'P9900000000000001378';
const PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}/`;

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER) || patternError(OTHER)) throw new Error('synthetic order is not a legal id');
if (!/^FO[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    vaultMode: 'ok',
    vaultPosts: 0,
    vaultGets: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handle(req, state) {
  const u = new URL(req.url());
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
    await req.continue();
    return;
  }
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' ' + u.hostname + u.pathname + u.search);
  if (u.hostname === ORDER_HOST || u.pathname === '/order/get' || u.pathname === '/order/redeem' || u.pathname.includes('/orders/')) {
    state.unexpected.push('order ' + req.method() + ' ' + u.hostname + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.hostname === 'mantledb.sh') {
    state.unexpected.push('mantle ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.hostname === VAULT_HOST && u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'down') {
      await req.abort('failed');
      return;
    }
    if (body.quiz !== 'family' || body.code !== CODE || body.orderId) {
      state.unexpected.push('vault body ' + JSON.stringify(body));
      return send(req, 400, { ok: false, error: 'invalid' });
    }
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  if (u.hostname === VAULT_HOST && u.pathname === '/get' && req.method() === 'GET') {
    state.vaultGets++;
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  state.unexpected.push('other ' + u.hostname + u.pathname);
  await req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      await handle(req, state);
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      vaultPosts: state.vaultPosts,
      vaultGets: state.vaultGets,
      bodies: state.bodies,
      urls: state.urls,
      unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => /\/orders\/|\/order\/|vercel|mantledb/.test(u));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qprog', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qprog').textContent !== prev, { timeout: 3000 }, before);
}

async function newPage(browser, state, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport(opts.viewport || { width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemVault === 'function');
  return { page, errors };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('page source keeps order unlock off the network', async () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const banned = [
    '/order/redeem',
    '/order/get',
    'vercel.app',
    'mantledb',
    'MANTLE_KEY',
    'soft_persimmon_order_uses',
    '次数已经用完',
    '暂时验证不了',
    'local-only',
    'cosmetic',
  ];
  for (const word of banned) assert(!html.includes(word), 'index.html contains ' + word);
  assert(html.includes('family_order_uses'), 'missing display-count key');
  assert(html.includes('paidVerified:false'), 'paidVerified must stay false');
  assert(html.includes('输入订单号'), 'order field label changed');
  assert(html.includes("LEGACY_API+'/redeem'"), 'vault redeem path missing');
  assert(html.includes('你难过或受委屈时'), 'first question changed');
});

test('format helpers reject patterns and keep FO codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order) => ({
    good: orderFormatError(order),
    repeat: orderFormatError('P111111111111111111'),
    seq: orderFormatError('P123456789012345678'),
    pasted: classifyInput(' 「p8473-6291-5028-374651」 '),
    code: classifyInput(' fo 2k 7m '),
    junk: classifyInput('hello'),
    shortP: classifyInput('P12345'),
    quiz: QUIZ_KEY,
    key: ORDER_USES_KEY,
    questions: QS.length,
    q0: QS[0].text,
    p19: orderFormatError('P9900000000000001378'),
    p19c: classifyInput('P9900000000000001378').type,
    copy: orderSuccessText({ ok: true, uses: 1, remaining: 2 }),
    lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0 }),
    laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0 }),
    paid: redeemOrder(order).paidVerified,
  }), ORDER);
  assert(out.good === '', 'legal synthetic id rejected ' + out.good);
  assert(out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced FO code ' + JSON.stringify(out.code));
  assert(out.junk.type === 'invalid' && out.shortP.type === 'invalid', 'classifier mixed');
  assert(out.quiz === 'family' && out.key === 'family_order_uses', 'quiz/key ' + out.quiz + ' ' + out.key);
  assert(out.questions === 18 && out.q0.startsWith('你难过或受委屈时'), 'question bank changed');
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.paid === false, 'paidVerified changed');
  assertNoOrderNet(state, 'format checks must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('valid id starts with no order request; refresh and continue keep the display', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const heading = await page.$eval('#codeMask h3', (el) => el.textContent);
  assert(heading === '输入订单号', heading);
  await openAndSubmit(page, ' 「p8473-6291-5028-374651」 ');
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assertNoOrderNet(state, 'first start must not call the network');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次', 'success copy ' + toast);
  assert((await page.$eval('#qprog', (el) => el.textContent)).includes('/ 18'), 'quiz length changed');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'refresh at question 1 changed the display count');
  assertNoOrderNet(state, 'refresh must not call the network');
  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval('#qprog', (el) => el.textContent.trim());
  assert(prog === '3 / 18', 'progress ' + prog);
  const qtext = await page.$eval('#qtext', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent.trim(),
    text: document.getElementById('qtext').textContent,
    qi,
    a0: ans[0],
    a1: ans[1],
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.a1 === 1 && resumed.text === qtext, 'mid refresh ' + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, 'mid refresh changed the display count');
  assertNoOrderNet(state, 'mid refresh must not call the network');
  await page.click('#qback');
  await page.click('#qback');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  const label = await page.$eval('#btnStart', (el) => el.textContent.trim());
  assert(label === '继续答题', label);
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent.trim(),
    sel: document.querySelectorAll('#opts .opt.sel').length,
    a0: ans[0],
  }));
  assert(cont.prog === '1 / 18' && cont.sel === 1 && cont.a0 === 1, 'continue reset the attempt ' + JSON.stringify(cont));
  assert(await shownUses(page) === 1, 'continue changed the display count');
  assertNoOrderNet(state, 'continue must not call the network');
  await page.evaluate(() => { clearUnlock(); show('start'); });
  await openAndSubmit(page, OTHER);
  await waitQuiz(page);
  assert(await shownUses(page, OTHER) === 1, 'second id should start at one');
  assert(await shownUses(page, ORDER) === 1, 'second id changed the first display count');
  assertNoOrderNet(state, 'second id must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result restore and 查看上次结果 do not advance; 重新测试 does; a later entry still starts', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstIndex = await page.$eval('.index-num', (el) => el.textContent.trim());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const peeked = await page.$eval('.index-num', (el) => el.textContent.trim());
  assert(peeked === firstIndex, 'result refresh changed the index');
  assert(await shownUses(page) === 1, 'result refresh changed the display count');
  assertNoOrderNet(state, 'result refresh must not call the network');

  await page.evaluate(() => show('start'));
  await page.click('#btnLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, '查看上次结果 changed the display count');
  assertNoOrderNet(state, '查看上次结果 must not call the network');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, 'retest should display the second use');
  const secondToast = await page.$eval('#toast', (el) => el.textContent);
  assert(secondToast === '验证成功，还可以测 1 次', secondToast);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent.trim(), len: ans.filter((v) => v != null).length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  const thirdToast = await page.$eval('#toast', (el) => el.textContent);
  assert(thirdToast === '验证成功，这是最后一次', thirdToast);
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(after.uses === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected on the page', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const samples = [P19, 'P111111111111111111', 'P123456789012345678', 'P1234567890', '随便写'];
  for (const sample of samples) {
    await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
    if (await page.$eval('#codeMask', (el) => !el.classList.contains('show'))) {
      await page.click('#btnStart');
      await page.waitForSelector('#codeMask.show');
    }
    await page.$eval('#codeInput', (el, v) => { el.value = v; }, sample);
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
    const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
    assert(!onQuiz, sample + ' started the quiz');
    assert(await shownUses(page) === 0, sample + ' recorded a display count');
  }
  assertNoOrderNet(state, 'rejected ids must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('an FO code still redeems on the vault and does not call Mantle or the order host', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'fo2k7m');
  await waitQuiz(page);
  assert(state.vaultPosts === 1, 'vault redeem count', state);
  assert(state.bodies[0].quiz === 'family' && state.bodies[0].code === CODE && !state.bodies[0].orderId, 'vault body', state);
  assert(state.vaultGets === 0, 'redeem must not peek first', state);
  assert(await shownUses(page, CODE) === 0, 'a code must not write the order display count');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('还可以测 2 次'), toast);
  assert(state.unexpected.length === 0, 'vault hit unexpected', state);
  assert(state.urls.every((u) => u.includes(VAULT_HOST) && u.includes('/redeem')), 'vault hit url', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('vault miss and exhausted code do not start the quiz or call Mantle', async (browser) => {
  const miss = freshState();
  miss.vaultMode = 'not_found';
  const opened = await newPage(browser, miss);
  await openAndSubmit(opened.page, CODE);
  await opened.page.waitForFunction(() => document.getElementById('toast').textContent.includes('验证码不正确'));
  const missQuiz = await opened.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!missQuiz && miss.vaultPosts === 1, 'vault miss', miss);
  assert(miss.unexpected.length === 0 && miss.urls.every((u) => u.includes(VAULT_HOST)), 'vault miss left the vault', miss);
  await opened.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('用完'));
  const doneQuiz = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!doneQuiz && done.vaultPosts === 1, 'exhausted code opened the quiz', done);
  assert(done.unexpected.length === 0, 'exhausted code called Mantle or the order host', done);
  await second.page.close();

  const down = freshState();
  down.vaultMode = 'down';
  const third = await newPage(browser, down);
  await openAndSubmit(third.page, CODE);
  await third.page.waitForFunction(() => document.getElementById('toast').textContent.includes('网络异常'));
  const downQuiz = await third.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!downQuiz && await third.page.evaluate(() => !isUnlocked()), 'vault outage unlocked');
  await third.page.close();
});

test('query string keeps a code without redeeming, and an order id does not auto-start', async (browser) => {
  const code = freshState();
  const p1 = await newPage(browser, code, { path: '?code=fo2k7m' });
  await p1.page.waitForSelector('#codeMask.show');
  const filled = await p1.page.$eval('#codeInput', (el) => el.value);
  assert(filled === CODE, 'url code was not kept: ' + filled);
  assert(code.vaultPosts === 0 && code.urls.length === 0, 'url code auto-submitted', code);
  const hint = await p1.page.$eval('.code-hint', (el) => el.textContent);
  assert(hint.includes('我的订单') && hint.includes('3 次') && !hint.includes('验证码'), hint);
  await p1.page.close();

  const order = freshState();
  const p2 = await newPage(browser, order, { path: '?code=' + ORDER });
  await p2.page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  const onQuiz = await p2.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && await shownUses(p2.page) === 0, 'query order auto-started');
  assertNoOrderNet(order, 'query order must not call the network');
  await p2.page.close();
});

function waitPort(port) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        if (Date.now() - start > 5000) reject(new Error('server did not start'));
        else setTimeout(tick, 40);
      });
    };
    tick();
  });
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await waitPort(PORT);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${ORDER_HOST} 127.0.0.1, MAP ${VAULT_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
