/* ===========================================================
   服务器接口自测：node dev/server-test.js
   起一个临时服务器（数据写到系统临时目录），把三个板子的接口全过一遍。
   =========================================================== */
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 38000 + Math.floor(Math.random() * 1500);
const DATA_FILE = path.join(os.tmpdir(), 'sly-board-test-' + Date.now() + '.json');
const LOG_FILE = path.join(os.tmpdir(), 'sly-board-test-' + Date.now() + '.log');

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch (e) {}
        resolve({ status: res.statusCode, text: d, json: j });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function startServer() {
  const fd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'dev', 'server.js'), '--port=' + PORT], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { SLY_BOARD_DATA: DATA_FILE }),
    stdio: ['ignore', fd, fd],   // 不用管道：沙箱里管道 stdio 会 EPERM
  });
  fs.closeSync(fd);
  return child;
}

async function waitUp(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await req('GET', '/api/board');
      if (r.status === 200 && r.json && r.json.ok) return true;
    } catch (e) {}
    await sleep(150);
  }
  return false;
}

(async function main() {
  let child = startServer();
  try {
    console.log('[1] 服务器起没起来  (端口 ' + PORT + ')');
    const up = await waitUp(10000);
    ok('接口能应答', up);
    if (!up) throw new Error('服务器没起来，日志在 ' + LOG_FILE);

    console.log('[2] 空板子');
    let r = await req('GET', '/api/board');
    ok('返回三个分类', r.json && r.json.items && ['ask', 'idea', 'praise'].every((k) => Array.isArray(r.json.items[k])));
    ok('都是空的', ['ask', 'idea', 'praise'].every((k) => r.json.items[k].length === 0));

    console.log('[3] 发一条留言');
    r = await req('POST', '/api/board', { kind: 'ask', text: '你最近在忙什么？', name: '一位姐妹' });
    ok('发成功了', r.status === 200 && r.json.ok, r.text.slice(0, 120));
    const item = r.json && r.json.item;
    ok('带上了 id / 时间', !!(item && item.id && item.at));
    ok('发了 token（撤回用）', !!(item && item.token));

    console.log('[4] 别人能看到，但看不到 token');
    r = await req('GET', '/api/board');
    const got = r.json.items.ask[0];
    ok('留言在板子上', got && got.text === '你最近在忙什么？');
    ok('署名也在', got && got.name === '一位姐妹', got && got.name);
    ok('token 没有泄露出去', got && got.token === undefined);

    console.log('[5] 乱七八糟的东西发不进来');
    r = await req('POST', '/api/board', { kind: 'ask', text: '   ' });
    ok('空内容被拦', r.status === 400, String(r.status));
    r = await req('POST', '/api/board', { kind: 'hack', text: 'x' });
    ok('乱写的分类被拦', r.status === 400, String(r.status));
    r = await req('POST', '/api/board', { kind: 'ask', text: 'a'.repeat(900) });
    ok('超长会被截断或拒绝', r.status === 400 || r.status === 429 || (r.json.item.text.length <= 500), r.status + ' ' + (r.json && r.json.item ? r.json.item.text.length : ''));

    console.log('[6] 发太快会被拦住');
    r = await req('POST', '/api/board', { kind: 'idea', text: '第二条' });
    ok('3 秒内连发被挡', r.status === 429, String(r.status));
    await sleep(3200);
    r = await req('POST', '/api/board', { kind: 'idea', text: '慢一点发就行了' });
    ok('等一下就能发', r.status === 200 && r.json.ok, String(r.status));
    const idea = r.json.item;

    console.log('[7] 撤回');
    r = await req('POST', '/api/board/delete', { id: idea.id, token: 'bad-token' });
    ok('token 不对删不掉', r.status === 403, String(r.status));
    r = await req('POST', '/api/board/delete', { id: idea.id, token: idea.token });
    ok('本人能撤回', r.status === 200 && r.json.ok, r.text.slice(0, 120));
    r = await req('GET', '/api/board');
    ok('撤回后确实没了', r.json.items.idea.length === 0);
    ok('留言板那条还在', r.json.items.ask.length === 1);

    console.log('[8] 存到文件里了');
    await sleep(200);
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    ok('数据文件里有这条', saved.ask && saved.ask.length === 1 && saved.ask[0].text === '你最近在忙什么？');

    console.log('[9] 服务器重启，留言还在');
    child.kill();
    await sleep(600);
    child = startServer();
    const up2 = await waitUp(10000);
    ok('重启后接口又能用', up2);
    r = await req('GET', '/api/board');
    ok('留言没丢', r.json.items.ask.length === 1 && r.json.items.ask[0].text === '你最近在忙什么？');

    console.log('[10] 静态文件');
    r = await req('GET', '/');
    ok('首页能打开', r.status === 200 && r.text.indexOf('关于 sly') >= 0, String(r.status));
    r = await req('GET', '/assets/board.js');
    ok('assets 能打开', r.status === 200 && r.text.indexOf('SlyBoard') >= 0, String(r.status));
    r = await req('GET', '/%E9%97%AE%E9%A2%98%E5%BA%93/%E8%AF%B4%E6%98%8E.txt');
    ok('题库不给外人看', r.status === 404, String(r.status));
    r = await req('GET', '/assets/../dev/server.js');
    ok('挡住 ../ 穿越', r.status === 404 || r.status === 403, String(r.status));

    console.log('[11] 用真浏览器打开共享模式（要能看见服务器上的留言）');
    const EDGE = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find((p) => fs.existsSync(p));
    if (!EDGE) {
      console.log('  (没找到 Edge，跳过这一段)');
    } else {
      const dump = path.join(os.tmpdir(), 'sly-shared-dom-' + Date.now() + '.html');
      const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sly-shared-'));
      const fdx = fs.openSync(dump, 'w');
      spawnSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-first-run',
        '--user-data-dir=' + prof,
        '--virtual-time-budget=8000',
        '--dump-dom',
        'http://127.0.0.1:' + PORT + '/',
      ], { stdio: ['ignore', fdx, 'ignore'], timeout: 120000 });
      fs.closeSync(fdx);
      fs.rmSync(prof, { recursive: true, force: true });
      const html = fs.readFileSync(dump, 'utf8');
      try { fs.unlinkSync(dump); } catch (e) {}
      ok('页面认出这是共享模式', html.indexOf('共享模式') >= 0);
      ok('服务器上的留言显示出来了', html.indexOf('你最近在忙什么？') >= 0);
      ok('页面上能看到署名', html.indexOf('一位姐妹') >= 0);
    }
  } catch (e) {
    fails++;
    console.log('  测试自己炸了：' + (e && e.message));
  } finally {
    if (child) child.kill();
    await sleep(300);
    try { fs.unlinkSync(DATA_FILE); } catch (e) {}
    try { fs.unlinkSync(LOG_FILE); } catch (e) {}
  }

  console.log(fails === 0 ? '\n服务器自测全部通过 ✅' : '\n服务器自测失败 ' + fails + ' 项 ❌');
  process.exit(fails === 0 ? 0 : 1);
})();
