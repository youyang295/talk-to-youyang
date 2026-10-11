/* ===========================================================
   留言板 / 改进建议 / 夸夸板
   -----------------------------------------------------------
   两种模式，页面自己判断：
     共享模式：双击「启动服务.bat」打开网站，大家写的都存到服务器上，互相看得见
     本地模式：直接双击 index.html，只存在这台电脑的浏览器里
   =========================================================== */
(function () {
  const LIMIT = 500;          // 一条最多多少字
  const NAME_LIMIT = 16;      // 署名最多多少字
  const KINDS = ['ask', 'idea', 'praise'];
  const LOCAL_KEY = 'sly_board_v1';       // 本地模式的留言
  const MINE_KEY = 'sly_board_mine_v1';   // 我发过哪几条（用来撤回）
  const POLL_MS = 20000;                  // 共享模式下多久自动刷一次

  const state = { mode: 'local', items: { ask: [], idea: [], praise: [] }, ready: false };
  const boards = Array.prototype.slice.call(document.querySelectorAll('.board'));
  const statusEl = document.getElementById('boardStatus');

  /* ---------------- 小工具 ---------------- */
  const apiUrl = (p) => new URL(p, location.href).href;
  const $ = (sel, root) => (root || document).querySelector(sel);

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function mine() {
    const m = readJSON(MINE_KEY, {});
    return m && typeof m === 'object' ? m : {};
  }
  function rememberMine(id, token) { const m = mine(); m[id] = token || ''; writeJSON(MINE_KEY, m); }
  function forgetMine(id) { const m = mine(); delete m[id]; writeJSON(MINE_KEY, m); }

  /* 没写署名时，用门禁里选的性别来称呼 */
  function defaultName() {
    let who = '朋友';
    try { if (window.SlyApp && window.SlyApp.callName) who = window.SlyApp.callName(); } catch (e) {}
    return '一位' + who;
  }

  function ago(ts) {
    const t = Number(ts) || 0;
    if (!t) return '';
    const d = Date.now() - t;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    if (d < 604800000) return Math.floor(d / 86400000) + ' 天前';
    const dd = new Date(t), p = (n) => String(n).padStart(2, '0');
    return dd.getFullYear() + '-' + p(dd.getMonth() + 1) + '-' + p(dd.getDate());
  }

  function normalize(raw) {
    const out = { ask: [], idea: [], praise: [] };
    KINDS.forEach((k) => {
      const list = raw && Array.isArray(raw[k]) ? raw[k] : [];
      out[k] = list
        .filter((it) => it && typeof it.text === 'string' && it.text.trim())
        .map((it) => ({ id: String(it.id || ''), text: String(it.text), name: String(it.name || ''), at: Number(it.at) || 0 }))
        .sort((a, b) => b.at - a.at);
    });
    return out;
  }

  /* ---------------- 跟服务器说话 ---------------- */
  async function call(path, opts) {
    const init = Object.assign({ cache: 'no-store' }, opts || {});
    if (init.body) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(apiUrl(path), init);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  /* 打开页面时判断：有服务器就是共享模式，没有就是本地模式 */
  async function detect() {
    if (location.protocol === 'file:') return false;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2000);
      const res = await fetch(apiUrl('api/board'), { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      if (data && data.ok && data.items) { state.items = normalize(data.items); return true; }
    } catch (e) { /* 没有服务器，走本地模式 */ }
    return false;
  }

  async function load() {
    if (state.mode === 'shared') {
      const data = await call('api/board');
      state.items = normalize(data.items);
    } else {
      state.items = normalize(readJSON(LOCAL_KEY, {}));
    }
    renderAll();
  }

  async function post(kind, text, name) {
    const base = { text, name: name || defaultName(), at: Date.now() };
    if (state.mode === 'shared') {
      const data = await call('api/board', { body: Object.assign({ kind }, base) });
      if (data.item && data.item.id) rememberMine(data.item.id, data.item.token || '');
      return;
    }
    const item = Object.assign({ id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }, base);
    const all = readJSON(LOCAL_KEY, {});
    all[kind] = [item].concat(Array.isArray(all[kind]) ? all[kind] : []);
    writeJSON(LOCAL_KEY, all);
    rememberMine(item.id, '');
  }

  async function remove(kind, id) {
    if (state.mode === 'shared') {
      await call('api/board/delete', { body: { id, token: mine()[id] || '' } });
    } else {
      const all = readJSON(LOCAL_KEY, {});
      all[kind] = (Array.isArray(all[kind]) ? all[kind] : []).filter((it) => it.id !== id);
      writeJSON(LOCAL_KEY, all);
    }
    forgetMine(id);
    await load();
  }

  /* ---------------- 渲染 ---------------- */
  function itemEl(it, kind) {
    const li = document.createElement('li');
    li.className = 'board-item';
    li.dataset.id = it.id;

    const head = document.createElement('div');
    head.className = 'bi-head';

    const nm = document.createElement('span');
    nm.className = 'bi-name';
    nm.textContent = it.name || defaultName();

    const tm = document.createElement('span');
    tm.className = 'bi-time';
    tm.textContent = ago(it.at);

    head.appendChild(nm);
    head.appendChild(tm);

    if (Object.prototype.hasOwnProperty.call(mine(), it.id)) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bi-del';
      del.textContent = '撤回';
      del.addEventListener('click', async () => {
        if (!del.classList.contains('confirm')) {       // 点两次才真删，防手滑
          del.classList.add('confirm');
          del.textContent = '确定撤回？';
          setTimeout(() => { del.classList.remove('confirm'); del.textContent = '撤回'; }, 3000);
          return;
        }
        del.disabled = true;
        try { await remove(kind, it.id); } catch (e) { del.disabled = false; del.textContent = '撤回'; }
      });
      head.appendChild(del);
    }

    const p = document.createElement('p');
    p.className = 'bi-text';
    p.textContent = it.text;

    li.appendChild(head);
    li.appendChild(p);
    return li;
  }

  function renderBoard(boardEl) {
    const kind = boardEl.dataset.kind;
    const items = state.items[kind] || [];
    const list = $('[data-role="list"]', boardEl);
    const empty = $('[data-role="empty"]', boardEl);
    const count = $('[data-role="count"]', boardEl);
    if (!list) return;

    list.textContent = '';
    items.forEach((it) => list.appendChild(itemEl(it, kind)));
    if (empty) empty.hidden = items.length > 0;
    if (count) count.textContent = items.length ? items.length + ' 条' : '还没有人写';
  }

  function renderAll() { boards.forEach(renderBoard); }

  function renderStatus() {
    if (!statusEl) return;
    const shared = state.mode === 'shared';
    statusEl.hidden = false;
    statusEl.className = 'board-status ' + (shared ? 'shared' : 'local');
    statusEl.textContent = '';

    const dot = document.createElement('span');
    dot.className = 'bs-dot';

    const txt = document.createElement('span');
    txt.className = 'bs-txt';
    txt.textContent = shared
      ? '共享模式：下面三个板子都连在服务器上，大家写的所有人都看得见。'
      : '本地模式：下面三个板子只存在这台电脑上，只有你看得见。想让别人也看见，双击文件夹里的「启动服务.bat」。';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bs-refresh';
    btn.textContent = '刷新';
    btn.addEventListener('click', () => { btn.disabled = true; refresh().finally(() => { btn.disabled = false; }); });

    statusEl.appendChild(dot);
    statusEl.appendChild(txt);
    statusEl.appendChild(btn);
  }

  async function refresh() {
    try { await load(); } catch (e) { /* 下次轮询再试 */ }
  }

  /* ---------------- 表单 ---------------- */
  boards.forEach((boardEl) => {
    const kind = boardEl.dataset.kind;
    if (KINDS.indexOf(kind) < 0) return;
    const form = $('[data-role="form"]', boardEl);
    if (!form) return;
    const ta = $('[data-role="text"]', boardEl);
    const nameInput = $('[data-role="name"]', boardEl);
    /* 署名提示跟着门禁里选的性别走（点进去的时候再更新，那时门禁早答完了） */
    if (nameInput) {
      nameInput.addEventListener('focus', () => {
        nameInput.placeholder = '署名（不填就写「' + defaultName() + '」）';
      });
    }
    const msg = $('[data-role="msg"]', boardEl);
    const btn = form.querySelector('button[type="submit"]');

    const say = (text, cls) => {
      if (!msg) return;
      msg.textContent = text;
      msg.className = 'board-msg' + (cls ? ' ' + cls : '');
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) { say('写点什么再发吧～', 'warn'); ta.focus(); return; }
      if (text.length > LIMIT) { say('太长了，' + LIMIT + ' 字以内。', 'warn'); return; }
      if ((state.items[kind][0] || {}).text === text) { say('这句刚刚发过了。', 'warn'); return; }

      btn.disabled = true;
      say('正在发…', '');
      try {
        await post(kind, text, nameInput.value.trim().slice(0, NAME_LIMIT));
        ta.value = '';
        await load();
        say(state.mode === 'shared' ? '发出去了，别人刷新就能看见。' : '发出去了，先存在这台电脑上。', 'ok');
      } catch (err) {
        say('没发出去：' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });
  });

  /* ---------------- 上线 ---------------- */
  (async function main() {
    state.mode = (await detect()) ? 'shared' : 'local';
    renderStatus();
    try { await load(); } catch (e) { renderAll(); }
    state.ready = true;

    if (state.mode === 'shared') {
      setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    }
  })();

  window.SlyBoard = {
    refresh,
    get mode() { return state.mode; },
    get items() { return state.items; },
    get ready() { return state.ready; },
    defaultName,
  };
})();
