/* ===========================================================
   关于 sly 的有趣问答 · 本地小服务器
   -----------------------------------------------------------
   跑法：双击「启动服务.bat」，或者在这个文件夹里执行 node dev/server.js
   作用：① 用 http 把网站发出去（同一个 WiFi 下手机也能看）
         ② 提供留言板接口，三个板子的内容都存进 数据/board.json
   零依赖，只用 Node 自带的东西，不用 npm install。
   =========================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const DATA_FILE = process.env.SLY_BOARD_DATA || path.join(ROOT, '数据', 'board.json');

const KINDS = ['ask', 'idea', 'praise'];
const MAX_ITEMS = 500;          // 每个板子最多留多少条
const MAX_BODY = 64 * 1024;     // 请求体上限
const TEXT_LIMIT = 500;         // 一条留言最多多少字
const NAME_LIMIT = 16;          // 署名最多多少字
const POST_GAP_MS = 3000;       // 同一个人两次发言至少隔多久

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* ---------------- 数据 ---------------- */
function blank() {
  const out = {};
  KINDS.forEach((k) => { out[k] = []; });
  return out;
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const j = JSON.parse(raw);
    const out = blank();
    KINDS.forEach((k) => {
      if (Array.isArray(j[k])) out[k] = j[k].filter((it) => it && it.text);
    });
    return out;
  } catch (e) {
    return blank();   // 文件不存在或坏了，就当空的重新开始
  }
}

let data = loadData();

function saveData() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------------- 小工具 ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function clean(str, max) {
  return String(str == null ? '' : str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')  // 去掉控制字符
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

/* 给外面看的版本：不带 token（token 是本人撤回用的，不能给别人） */
function publicItem(it) {
  return { id: it.id, text: it.text, name: it.name, at: it.at };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('内容太大了')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('格式看不懂')); }
    });
    req.on('error', reject);
  });
}

/* ---------------- 静态文件 ---------------- */
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 没找到'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(ROOT, 'index.html'));
  }
  if (pathname.indexOf('/assets/') === 0) {
    const full = path.resolve(ASSETS, '.' + pathname.slice('/assets'.length));
    if (full.indexOf(ASSETS) !== 0) { res.writeHead(403); res.end('403'); return; }   // 防 ../ 穿越
    return serveFile(res, full);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 没找到');
}

/* ---------------- 请求处理 ---------------- */
const lastPost = new Map();

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  /* ---- 读三个板子 ---- */
  if (p === '/api/board' && req.method === 'GET') {
    const items = {};
    KINDS.forEach((k) => { items[k] = data[k].map(publicItem); });
    return json(res, 200, { ok: true, mode: 'shared', items });
  }

  /* ---- 发一条 ---- */
  if (p === '/api/board' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }

    const kind = String(body.kind || '');
    if (KINDS.indexOf(kind) < 0) return json(res, 400, { ok: false, error: '不知道要发到哪个板子' });

    const text = clean(body.text, TEXT_LIMIT);
    if (!text) return json(res, 400, { ok: false, error: '写点什么再发吧' });

    const ip = req.socket.remoteAddress || '?';
    const now = Date.now();
    if (now - (lastPost.get(ip) || 0) < POST_GAP_MS) {
      return json(res, 429, { ok: false, error: '别刷太快，歇口气再发' });
    }
    lastPost.set(ip, now);

    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      text,
      name: clean(body.name, NAME_LIMIT) || '一位朋友',
      at: now,
      token: crypto.randomBytes(12).toString('hex'),   // 只有发的人拿得到，用来撤回
    };
    data[kind].unshift(item);
    if (data[kind].length > MAX_ITEMS) data[kind].length = MAX_ITEMS;
    saveData();

    console.log('  [' + new Date().toLocaleTimeString('zh-CN') + '] ' + kind + ' +1  ' + text.slice(0, 40).replace(/\n/g, ' '));
    return json(res, 200, { ok: true, item: Object.assign(publicItem(item), { token: item.token }) });
  }

  /* ---- 撤回自己发的 ---- */
  if (p === '/api/board/delete' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }

    const id = String(body.id || '');
    const token = String(body.token || '');
    for (const k of KINDS) {
      const i = data[k].findIndex((it) => it.id === id);
      if (i < 0) continue;
      if (!token || data[k][i].token !== token) {
        return json(res, 403, { ok: false, error: '只能撤回自己发的那条' });
      }
      data[k].splice(i, 1);
      saveData();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: '这条已经不在板子上了' });
  }

  if (p.indexOf('/api/') === 0) return json(res, 404, { ok: false, error: '没有这个接口' });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('405');
  }
  return serveStatic(res, decodeURIComponent(p));
}

/* ---------------- 启动 ---------------- */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((n) => {
      if (n && n.family === 'IPv4' && !n.internal) out.push(n.address);
    });
  });
  return out;
}

function banner(port) {
  const lan = lanAddresses();
  console.log('');
  console.log('  ==================================================');
  console.log('   关于 sly 的有趣问答 · 服务器已启动');
  console.log('  ==================================================');
  console.log('');
  console.log('   这台电脑打开：     http://127.0.0.1:' + port);
  lan.forEach((ip) => console.log('   同一个 WiFi 打开： http://' + ip + ':' + port));
  if (!lan.length) console.log('   （没读到局域网地址，只能这台电脑看）');
  console.log('');
  console.log('   三个板子的留言存在： ' + DATA_FILE);
  console.log('   关掉这个窗口 = 网站下线（写过的不会丢）');
  console.log('');
}

const argPort = (process.argv.find((a) => a.indexOf('--port=') === 0) || '').split('=')[1];
const START_PORT = Number(process.env.PORT || argPort || 8080);

function start(port, tries) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      json(res, 500, { ok: false, error: '服务器出错了：' + e.message });
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries > 0) {
      console.log('  端口 ' + port + ' 被占了，换 ' + (port + 1) + ' 试试…');
      start(port + 1, tries - 1);
    } else {
      console.error('  启动失败：' + err.message);
      process.exit(1);
    }
  });

  server.listen(port, '0.0.0.0', () => banner(port));

  process.on('SIGINT', () => {
    console.log('\n  服务器关了，写过的留言都还在 ' + DATA_FILE);
    process.exit(0);
  });
}

start(START_PORT, 10);
