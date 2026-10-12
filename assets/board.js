/* ===========================================================
   留言板 / 改进建议 / 夸夸板
   -----------------------------------------------------------
   三种模式，页面自己从上往下试：
     共享模式：双击「启动服务.bat」打开网站，大家写的都存到那台服务器上
     云端模式：填好下面 CLOUD 里的地址和 key，挂在公网上（GitHub Pages）也能共享
     本地模式：直接双击 index.html，只存在这台电脑的浏览器里

   留言板（ask）和夸夸板（praise）有点赞 + 评论；
   改进建议（idea）保持干干净净，只收建议。
   =========================================================== */
(function () {
  /* ---------------- 云数据库（Supabase）配置 ----------------
     想让公网上的网站也能共享留言，照 README 里
     「让留言全网都能看见（Supabase 云端模式）」那一节做，然后把下面两行填上：
       url —— 形如 https://abcdefgh.supabase.co
       key —— anon public / publishable 那一把（本来就是给浏览器看的）
     两行都留空 = 不启用云端模式。
     页面里要是先写了 window.SLY_CLOUD，会用它盖掉下面这份（测试用得上）。 */
  const CLOUD = Object.assign({
    url: 'https://flrssttfirqdpncaeiql.supabase.co',
    key: 'sb_publishable_mDSlb7v0-_SsbUBxur5rVw_Y9tFTpma',
    table: 'sly_messages',            // 存留言的表
    view: 'sly_public',               // 对外的只读视图（不含撤回用的 token）
    delFn: 'sly_delete',              // 撤回用的数据库函数
    commentTable: 'sly_comments',     // 存评论的表
    commentView: 'sly_comments_public',
    likeFn: 'sly_like',               // 给留言点赞
    likeCommentFn: 'sly_like_comment',// 给评论点赞
  }, window.SLY_CLOUD || {});

  const LIMIT = 500;          // 一条留言最多多少字
  const NAME_LIMIT = 16;      // 署名最多多少字
  const COMMENT_LIMIT = 300;  // 一条评论最多多少字
  const NOTE_LIMIT = 300;     // 带在身上的「经历」最多多少字
  const TOP_COMMENTS = 3;     // 默认露出几条评论（按赞数排）
  const KINDS = ['ask', 'idea', 'praise'];
  const TALK_KINDS = ['ask', 'praise'];   // 有点赞和评论的板子
  const LOCAL_KEY = 'sly_board_v1';       // 本地模式的留言
  const MINE_KEY = 'sly_board_mine_v1';   // 我发过哪几条（用来撤回）
  const LIKED_KEY = 'sly_board_liked_v1'; // 我点过赞的（留言 id / 评论 id）
  const PASS_KEY = 'sly_gate_pass_v1';    // 门禁里留下的记录（含「经历」）
  const POLL_MS = 20000;                  // 共享 / 云端模式下多久自动刷一次
  const MAX_ITEMS = 500;                  // 一次最多取多少条留言
  const MAX_COMMENTS = 2000;              // 一次最多取多少条评论

  const state = {
    mode: 'local',
    items: { ask: [], idea: [], praise: [] },
    ready: false,
    expanded: {},   // 哪几条留言把「其余评论」展开了
    opened: {},     // 哪几条留言把评论输入框点开了
  };
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

  /* 我点过赞的：留言 id / 评论 id 都记在这儿，同一台电脑点第二次就是取消赞 */
  function liked() {
    const m = readJSON(LIKED_KEY, {});
    return m && typeof m === 'object' ? m : {};
  }
  const isLiked = (id) => !!liked()[id];
  function setLiked(id, on) {
    const m = liked();
    if (on) m[id] = 1; else delete m[id];
    writeJSON(LIKED_KEY, m);
  }

  /* 没写署名时，用门禁里选的性别来称呼 */
  function defaultName() {
    let who = '朋友';
    try { if (window.SlyApp && window.SlyApp.callName) who = window.SlyApp.callName(); } catch (e) {}
    return '一位' + who;
  }

  /* 门禁第一屏让人写的「你和我有关的经历」—— 留言时带着走，别人点名字就能看见 */
  function passNote() {
    try {
      if (window.SlyApp && window.SlyApp.passNote) {
        const n = String(window.SlyApp.passNote() || '').trim();
        if (n) return n.slice(0, NOTE_LIMIT);
      }
    } catch (e) {}
    try {
      const rec = readJSON(PASS_KEY, null);
      return rec && rec.note ? String(rec.note).trim().slice(0, NOTE_LIMIT) : '';
    } catch (e) { return ''; }
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

  function normComment(c) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) return null;
    return {
      id: String(c.id || ''),
      text: String(c.text),
      name: String(c.name || ''),
      note: String(c.note || ''),
      at: Number(c.at) || 0,
      likes: Math.max(0, Number(c.likes) || 0),
    };
  }

  function normItem(it) {
    return {
      id: String(it.id || ''),
      text: String(it.text),
      name: String(it.name || ''),
      note: String(it.note || ''),
      at: Number(it.at) || 0,
      likes: Math.max(0, Number(it.likes) || 0),
      comments: (Array.isArray(it.comments) ? it.comments : [])
        .map(normComment).filter(Boolean).sort((a, b) => b.at - a.at),
    };
  }

  function normalize(raw) {
    const out = { ask: [], idea: [], praise: [] };
    KINDS.forEach((k) => {
      const list = raw && Array.isArray(raw[k]) ? raw[k] : [];
      out[k] = list
        .filter((it) => it && typeof it.text === 'string' && it.text.trim())
        .map(normItem)
        .sort((a, b) => b.at - a.at);
    });
    return out;
  }

  /* 评论怎么排：赞多的在前，一样多就新的在前。
     前 TOP_COMMENTS 条直接露出来，剩下的折起来等用户自己展开。 */
  function orderComments(list) {
    const byLike = (list || []).slice().sort((a, b) => (b.likes - a.likes) || (b.at - a.at));
    return { top: byLike.slice(0, TOP_COMMENTS), rest: byLike.slice(TOP_COMMENTS) };
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

  /* ---------------- 跟云数据库说话（Supabase 的 REST 接口，不用装 SDK） ---------------- */
  const cloudReady = () => !!(CLOUD.url && CLOUD.key);

  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    const b = new Uint8Array(16);
    try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.prototype.map.call(b, (x) => ('0' + x.toString(16)).slice(-2)).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  const cloudHeaders = (extra) => Object.assign({
    apikey: CLOUD.key,
    Authorization: 'Bearer ' + CLOUD.key,
  }, extra || {});

  /* 数据库挡回来的时候，把它的原话拿出来给人看 */
  async function cloudWhy(res) {
    let why = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      if (j && (j.message || j.hint)) why = j.message || j.hint;
    } catch (e) {}
    return why;
  }

  async function cloudLoad() {
    const url = CLOUD.url + '/rest/v1/' + CLOUD.view +
      '?select=id,kind,name,note,text,at,likes&order=at.desc&limit=' + MAX_ITEMS;
    const res = await fetch(url, { headers: cloudHeaders(), cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const grouped = {};
    KINDS.forEach((k) => { grouped[k] = []; });
    const byId = {};
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      if (!grouped[r.kind]) return;
      const it = {
        id: r.id, text: r.text, name: r.name, note: r.note || '',
        likes: r.likes || 0, at: Date.parse(r.at) || 0, comments: [],
      };
      grouped[r.kind].push(it);
      byId[it.id] = it;
    });
    /* 评论单独取一趟，取不到也不能把留言弄丢 */
    try {
      const curl = CLOUD.url + '/rest/v1/' + CLOUD.commentView +
        '?select=id,msg_id,name,note,text,at,likes&order=at.desc&limit=' + MAX_COMMENTS;
      const cres = await fetch(curl, { headers: cloudHeaders(), cache: 'no-store' });
      if (cres.ok) {
        const crows = await cres.json();
        (Array.isArray(crows) ? crows : []).forEach((c) => {
          const parent = byId[c.msg_id];
          if (!parent) return;
          parent.comments.push({
            id: c.id, name: c.name, note: c.note || '', text: c.text,
            at: Date.parse(c.at) || 0, likes: c.likes || 0,
          });
        });
      }
    } catch (e) { /* 评论这趟没成功，下次轮询再补 */ }
    state.items = normalize(grouped);
  }

  async function cloudPost(kind, text, name) {
    const row = {
      id: uuid(),
      kind,
      name: name || defaultName(),
      note: passNote(),
      text,
      token: uuid(),                       // 只有这台浏览器知道，用来撤回
      at: new Date().toISOString(),
    };
    const res = await fetch(CLOUD.url + '/rest/v1/' + CLOUD.table, {
      method: 'POST',
      headers: cloudHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(await cloudWhy(res));
    rememberMine(row.id, row.token);
  }

  async function cloudComment(kind, msgId, text, name) {
    const row = {
      id: uuid(),
      msg_id: msgId,
      kind,
      name: name || defaultName(),
      note: passNote(),
      text,
      token: uuid(),
      at: new Date().toISOString(),
    };
    const res = await fetch(CLOUD.url + '/rest/v1/' + CLOUD.commentTable, {
      method: 'POST',
      headers: cloudHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(await cloudWhy(res));
  }

  async function cloudRemove(id) {
    const res = await fetch(CLOUD.url + '/rest/v1/rpc/' + CLOUD.delFn, {
      method: 'POST',
      headers: cloudHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_id: id, p_token: mine()[id] || '' }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const done = await res.json().catch(() => false);
    if (done !== true) throw new Error('没删掉：这条不是这台电脑发的');
    forgetMine(id);
  }

  async function cloudLike(id, delta, isComment) {
    const fn = isComment ? CLOUD.likeCommentFn : CLOUD.likeFn;
    const res = await fetch(CLOUD.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: cloudHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_id: id, p_delta: delta }),
    });
    if (!res.ok) throw new Error(await cloudWhy(res));
    return Number(await res.json().catch(() => 0)) || 0;
  }

  /* 打开页面时判断走哪种模式：自家服务器 > 云数据库 > 本地 */
  async function detect() {
    if (location.protocol !== 'file:') {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 2000);
        const res = await fetch(apiUrl('api/board'), { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok && data.items) { state.items = normalize(data.items); return 'shared'; }
        }
      } catch (e) { /* 没有自家服务器，接着看云端 */ }
    }
    if (cloudReady()) {
      try { await cloudLoad(); return 'cloud'; } catch (e) {
        state.cloudErr = String((e && e.message) || e);   // 云端没连上，退回本地，但把原因记下来
      }
    }
    return 'local';
  }

  async function load() {
    if (state.mode === 'shared') {
      const data = await call('api/board');
      state.items = normalize(data.items);
    } else if (state.mode === 'cloud') {
      await cloudLoad();
    } else {
      state.items = normalize(readJSON(LOCAL_KEY, {}));
    }
    renderAll();
  }

  async function post(kind, text, name) {
    const base = { text, name: name || defaultName(), note: passNote(), at: Date.now() };
    if (state.mode === 'shared') {
      const data = await call('api/board', { body: Object.assign({ kind }, base) });
      if (data.item && data.item.id) rememberMine(data.item.id, data.item.token || '');
      return;
    }
    if (state.mode === 'cloud') { await cloudPost(kind, text, name); return; }
    const item = Object.assign({
      id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      likes: 0,
      comments: [],
    }, base);
    const all = readJSON(LOCAL_KEY, {});
    all[kind] = [item].concat(Array.isArray(all[kind]) ? all[kind] : []);
    writeJSON(LOCAL_KEY, all);
    rememberMine(item.id, '');
  }

  async function remove(kind, id) {
    if (state.mode === 'shared') {
      await call('api/board/delete', { body: { id, token: mine()[id] || '' } });
    } else if (state.mode === 'cloud') {
      await cloudRemove(id);
    } else {
      const all = readJSON(LOCAL_KEY, {});
      all[kind] = (Array.isArray(all[kind]) ? all[kind] : []).filter((it) => it.id !== id);
      writeJSON(LOCAL_KEY, all);
    }
    forgetMine(id);
    await load();
  }

  /* 点「♥」：同一台电脑点第二次就是取消赞 */
  async function like(kind, id, commentId) {
    const key = commentId || id;
    const on = !isLiked(key);
    const delta = on ? 1 : -1;
    if (state.mode === 'shared') {
      await call('api/board/like', { body: { kind, id, commentId: commentId || '', delta } });
    } else if (state.mode === 'cloud') {
      await cloudLike(key, delta, !!commentId);
    } else {
      const all = readJSON(LOCAL_KEY, {});
      const list = Array.isArray(all[kind]) ? all[kind] : [];
      const it = list.filter((x) => x.id === id)[0];
      if (it) {
        if (commentId) {
          const c = (Array.isArray(it.comments) ? it.comments : []).filter((x) => x.id === commentId)[0];
          if (c) c.likes = Math.max(0, (Number(c.likes) || 0) + delta);
        } else {
          it.likes = Math.max(0, (Number(it.likes) || 0) + delta);
        }
        writeJSON(LOCAL_KEY, all);
      }
    }
    setLiked(key, on);
    await load();
  }

  async function comment(kind, id, text, name) {
    const who = name || defaultName();
    if (state.mode === 'shared') {
      await call('api/board/comment', { body: { kind, id, text, name: who, note: passNote() } });
      return;
    }
    if (state.mode === 'cloud') { await cloudComment(kind, id, text, who); return; }
    const all = readJSON(LOCAL_KEY, {});
    const list = Array.isArray(all[kind]) ? all[kind] : [];
    const it = list.filter((x) => x.id === id)[0];
    if (!it) throw new Error('这条留言还在不在？刷新一下试试');
    if (!Array.isArray(it.comments)) it.comments = [];
    it.comments.push({
      id: 'local-c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text, name: who, note: passNote(), at: Date.now(), likes: 0,
    });
    writeJSON(LOCAL_KEY, all);
  }

  /* ---------------- 点名字看经历 ---------------- */
  function showNote(name, note) {
    const pop = document.getElementById('notePop');
    if (!pop) return;
    const nm = document.getElementById('npName');
    const tx = document.getElementById('npText');
    if (nm) nm.textContent = name || defaultName();
    if (tx) {
      tx.textContent = note || 'TA 没留经历 —— 可能是路过，也可能忘了写。';
      tx.className = note ? 'np-text' : 'np-text np-none';
    }
    pop.hidden = false;
    pop.classList.add('on');
    const close = document.getElementById('npClose');
    if (close) close.focus();
  }

  function hideNote() {
    const pop = document.getElementById('notePop');
    if (!pop) return;
    pop.classList.remove('on');
    pop.hidden = true;
  }

  function nameEl(name, note, cls) {
    const nm = document.createElement('button');
    nm.type = 'button';
    nm.className = 'bi-name' + (cls ? ' ' + cls : '');
    nm.textContent = name || defaultName();
    nm.title = '点一下看看 TA 和 sly 的经历';
    nm.addEventListener('click', () => showNote(nm.textContent, note));
    return nm;
  }

  /* ---------------- 渲染 ---------------- */
  function commentEl(it, kind, c) {
    const li = document.createElement('li');
    li.className = 'ci';
    li.dataset.id = c.id;

    const head = document.createElement('div');
    head.className = 'ci-head';
    head.appendChild(nameEl(c.name, c.note, 'ci-name'));

    const tm = document.createElement('span');
    tm.className = 'ci-time';
    tm.textContent = ago(c.at);
    head.appendChild(tm);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ci-like' + (isLiked(c.id) ? ' on' : '');
    btn.textContent = '♥ ' + c.likes;
    btn.title = isLiked(c.id) ? '取消点赞' : '这条评论说得不错';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await like(kind, it.id, c.id); } catch (e) { btn.disabled = false; }
    });
    head.appendChild(btn);

    const p = document.createElement('p');
    p.className = 'ci-text';
    p.textContent = c.text;

    li.appendChild(head);
    li.appendChild(p);
    return li;
  }

  function commentsEl(it, kind) {
    const wrap = document.createElement('div');
    wrap.className = 'bi-comments';

    const list = document.createElement('ul');
    list.className = 'ci-list';
    const ordered = orderComments(it.comments);
    const shown = state.expanded[it.id] ? ordered.top.concat(ordered.rest) : ordered.top;
    if (shown.length) shown.forEach((c) => list.appendChild(commentEl(it, kind, c)));
    else {
      const none = document.createElement('li');
      none.className = 'ci-none';
      none.textContent = '还没有人评论，你来抢第一条。';
      list.appendChild(none);
    }
    wrap.appendChild(list);

    if (ordered.rest.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ci-more';
      more.textContent = state.expanded[it.id]
        ? '收起'
        : '展开其余 ' + ordered.rest.length + ' 条（按赞数排在前 ' + ordered.top.length + ' 条后面）';
      more.addEventListener('click', () => {
        state.expanded[it.id] = !state.expanded[it.id];
        renderAll();
      });
      wrap.appendChild(more);
    }

    const form = document.createElement('form');
    form.className = 'ci-form';
    form.hidden = !state.opened[it.id];
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = COMMENT_LIMIT;
    inp.className = 'ci-input';
    inp.placeholder = '说点什么…（署名用「' + defaultName() + '」）';
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'btn btn-sm ci-send';
    send.textContent = '发送';
    const msg = document.createElement('p');
    msg.className = 'board-msg';
    form.appendChild(inp);
    form.appendChild(send);
    form.appendChild(msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = inp.value.trim();
      if (!text) { msg.textContent = '写点什么再发吧～'; msg.className = 'board-msg warn'; inp.focus(); return; }
      send.disabled = true;
      msg.textContent = '正在发…';
      msg.className = 'board-msg';
      try {
        await comment(kind, it.id, text, '');
        inp.value = '';
        state.opened[it.id] = false;
        await load();
      } catch (err) {
        msg.textContent = '没发出去：' + err.message;
        msg.className = 'board-msg err';
      } finally {
        send.disabled = false;
      }
    });
    wrap.appendChild(form);
    return wrap;
  }

  function barEl(it, kind) {
    const bar = document.createElement('div');
    bar.className = 'bi-bar';

    const btnLike = document.createElement('button');
    btnLike.type = 'button';
    btnLike.className = 'bi-like' + (isLiked(it.id) ? ' on' : '');
    btnLike.textContent = '♥ ' + it.likes;
    btnLike.title = isLiked(it.id) ? '取消点赞' : '点个赞';
    btnLike.addEventListener('click', async () => {
      btnLike.disabled = true;
      try { await like(kind, it.id, ''); } catch (e) { btnLike.disabled = false; }
    });
    bar.appendChild(btnLike);

    const btnSay = document.createElement('button');
    btnSay.type = 'button';
    btnSay.className = 'bi-say';
    btnSay.textContent = it.comments.length ? '说两句（' + it.comments.length + '）' : '说两句';
    btnSay.addEventListener('click', () => {
      state.opened[it.id] = !state.opened[it.id];
      renderAll();
      if (state.opened[it.id]) {
        const box = document.querySelector('.board-item[data-id="' + it.id + '"] .ci-input');
        if (box) box.focus();
      }
    });
    bar.appendChild(btnSay);

    return bar;
  }

  function itemEl(it, kind) {
    const li = document.createElement('li');
    li.className = 'board-item';
    li.dataset.id = it.id;

    const head = document.createElement('div');
    head.className = 'bi-head';

    head.appendChild(nameEl(it.name, it.note, ''));

    const tm = document.createElement('span');
    tm.className = 'bi-time';
    tm.textContent = ago(it.at);
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

    if (TALK_KINDS.indexOf(kind) >= 0) {
      li.appendChild(barEl(it, kind));
      if (it.comments.length || state.opened[it.id]) li.appendChild(commentsEl(it, kind));
    }
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
    const shared = state.mode === 'shared' || state.mode === 'cloud';
    const online = location.protocol !== 'file:';   // 挂在网上（比如 GitHub Pages）但没后台
    statusEl.hidden = false;
    statusEl.className = 'board-status ' + (shared ? 'shared' : 'local');
    statusEl.textContent = '';

    const dot = document.createElement('span');
    dot.className = 'bs-dot';

    const txt = document.createElement('span');
    txt.className = 'bs-txt';
    txt.textContent = state.mode === 'cloud'
      ? '云端模式：三个板子都连在云数据库上，谁写的所有人都看得见。'
      : state.mode === 'shared'
        ? '共享模式：下面三个板子都连在服务器上，大家写的所有人都看得见。'
        : online
          ? '这台站还没接后台：留言只存在你自己的浏览器里，别人看不见，站主也收不到。'
          : '本地模式：下面三个板子只存在这台电脑上，只有你看得见。想让别人也看见，双击文件夹里的「启动服务.bat」。';
    /* 明明配了云数据库却没连上：多半是新版 supabase.sql 还没跑（缺 note/likes 列、评论表） */
    if (state.mode === 'local' && cloudReady() && state.cloudErr) {
      txt.textContent += '（云数据库没连上：' + state.cloudErr +
        ' —— 看看新版 supabase.sql 是不是还没在 Supabase 里跑一遍）';
    }

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
        say(state.mode === 'shared' || state.mode === 'cloud'
          ? '发出去了，别人刷新就能看见。'
          : '发出去了，先存在这台电脑上。', 'ok');
      } catch (err) {
        say('没发出去：' + err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });
  });

  /* 经历浮层：点空白、点 ×、按 Esc 都能关 */
  (function wireNotePop() {
    const pop = document.getElementById('notePop');
    if (!pop) return;
    const close = document.getElementById('npClose');
    if (close) close.addEventListener('click', hideNote);
    pop.addEventListener('click', (e) => { if (e.target === pop) hideNote(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideNote(); });
  })();

  /* ---------------- 上线 ---------------- */
  (async function main() {
    state.mode = await detect();
    renderStatus();
    try { await load(); } catch (e) { renderAll(); }
    state.ready = true;

    if (state.mode === 'shared' || state.mode === 'cloud') {
      setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    }
  })();

  window.SlyBoard = {
    refresh,
    get mode() { return state.mode; },
    get items() { return state.items; },
    get ready() { return state.ready; },
    defaultName,
    passNote,
  };
})();
