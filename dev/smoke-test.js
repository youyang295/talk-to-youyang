/* ===========================================================
   冒烟测试：用假 DOM 跑真实的 assets/app.js，验证门禁 + 舞台切换
   跑法：node dev/smoke-test.js
   =========================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, '..', 'assets', 'app.js');
const code = fs.readFileSync(APP, 'utf8');

const store = new Map(); // 跨"刷新"共享的 localStorage

class El {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.dataset = {};
    this.offsetWidth = 1;
    this._cls = new Set();
    this._h = {};
    this._attr = {};
    this.classList = {
      add: (...c) => c.forEach((x) => this._cls.add(x)),
      remove: (...c) => c.forEach((x) => this._cls.delete(x)),
      contains: (c) => this._cls.has(c),
    };
  }
  addEventListener(t, fn) { this._h[t] = fn; }
  fire(t, ev = {}) { if (this._h[t]) this._h[t]({ preventDefault() {}, ...ev }); }
  focus() { this._focused = true; }
  select() {}
  reset() { this.value = ''; }
  requestSubmit() { this.fire('submit'); }
  setAttribute(k, v) { this._attr[k] = String(v); }
  getAttribute(k) { return this._attr[k]; }
  closest(sel) { return sel === '.pill' && this._isPill ? this : null; }
  querySelectorAll(sel) { return sel === '.pill' ? this._pills || [] : []; }
  classes() { return [...this._cls].sort().join(','); }
}

const IDS = [
  'gate', 'gateCard', 'site', 'quiz', 'gateForm',
  'q1', 'q2', 'q1Msg', 'q2Msg', 'genderMsg',
  'genderGroup', 'field1', 'field2', 'fieldG',
  'tip', 'enterBtn', 'lockBtn',
  'noteText', 'passTime', 'signGender', 'year',
];

function newPage() {
  const els = {};
  IDS.forEach((i) => (els[i] = new El(i)));
  els.tip.hidden = true;
  els.site.hidden = true; // index.html 里 #site / #quiz 自带 hidden 属性
  els.quiz.hidden = true;

  els.genderGroup._pills = ['男生', '女生', '保密'].map((v) => {
    const p = new El('pill-' + v);
    p._isPill = true;
    p.dataset.value = v;
    return p;
  });

  const calls = { onEnter: 0, refresh: 0 };
  const sandbox = {
    console, setTimeout, clearTimeout, Date, JSON, String,
    document: { getElementById: (id) => els[id] || null },
    window: {
      scrollTo() {},
      SlyQuiz: { onEnter: () => { calls.onEnter++; }, refresh: () => { calls.refresh++; } },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: APP });
  els.__calls = calls;
  els.__sandbox = sandbox;
  return els;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

/* 模拟点性别按钮 */
function pickGender(page, value) {
  const pill = page.genderGroup._pills.find((p) => p.dataset.value === value);
  page.genderGroup.fire('click', { target: pill });
  return pill;
}

(async () => {
  console.log('[1] 首次进入：应停在门禁页');
  let e = newPage();
  ok('gate 可见', e.gate.hidden === false);
  ok('site 隐藏', e.site.hidden === true);
  ok('quiz 隐藏', e.quiz.hidden === true);
  ok('年份已填', String(e.year.textContent).length === 4, e.year.textContent);

  console.log('[2] 第 1 题答错');
  e.q1.value = '张三';
  e.gateForm.fire('submit');
  ok('显示指定文案', e.q1Msg.textContent === '小坏蛋快去私信问问我', JSON.stringify(e.q1Msg.textContent));
  ok('错误态', e.field1.classList.contains('error'));
  ok('卡片抖动', e.gateCard.classList.contains('shake'));
  ok('未放行', e.site.hidden === true);
  ok('未提示', e.tip.hidden === true);

  console.log('[3] 连错 3 次给提示');
  e.q1.value = '李四'; e.gateForm.fire('submit');
  e.q1.value = '王五'; e.gateForm.fire('submit');
  ok('提示出现', e.tip.hidden === false, e.tip.textContent);

  console.log('[4] 答案容错：空格 / 大小写 / 标点（性别、经历都填好）');
  ['孙路遥', ' 孙 路 遥 ', '孙路遥。', 'sly', 'SLY', ' sly '].forEach((v) => {
    const p = newPage();
    p.q1.value = v;
    pickGender(p, '女生');
    p.q2.value = '和 sly 的那次通宵';
    p.gateForm.fire('submit');
    ok('接受 "' + v + '"', p.q2Msg.textContent === '好，我记下了。', JSON.stringify(p.q2Msg.textContent));
  });
  const bad = newPage();
  bad.q1.value = '孙路';
  pickGender(bad, '女生');
  bad.q2.value = '随便写点';
  bad.gateForm.fire('submit');
  ok('拒绝 "孙路"', bad.q1Msg.textContent === '小坏蛋快去私信问问我');

  console.log('[5] 全名对、性别没选：应拦住');
  store.clear(); // 模拟全新访客
  e = newPage();
  e.q1.value = '孙路遥';
  e.gateForm.fire('submit');
  ok('第 1 题通过标记', e.q1Msg.textContent === '嗯，是我。', e.q1Msg.textContent);
  ok('性别报错', e.genderMsg.textContent === '选一个吧，我好知道该怎么称呼你。', e.genderMsg.textContent);
  ok('仍不放行', e.site.hidden === true);

  console.log('[6] 性别选了、经历空：应拦住');
  pickGender(e, '保密');
  e.gateForm.fire('submit');
  ok('性别通过标记', e.genderMsg.textContent === '记下了。', e.genderMsg.textContent);
  ok('经历报错', e.q2Msg.textContent === '这条得写点什么吧，不然我怎么知道你是谁～');
  ok('仍不放行', e.site.hidden === true);
  ok('选中的按钮标了 aria-checked', e.genderGroup._pills[2].getAttribute('aria-checked') === 'true');
  ok('没选中的是 false', e.genderGroup._pills[0].getAttribute('aria-checked') === 'false');

  console.log('[7] 三题都对：进入主站 + 记住');
  const note = '那天你把最后一瓶水给了我，还记得吗';
  e.q2.value = note;
  e.gateForm.fire('submit');
  await sleep(900);
  ok('gate 隐藏', e.gate.hidden === true);
  ok('site 显示', e.site.hidden === false);
  ok('经历回显', e.noteText.textContent === note);
  ok('性别回显', e.signGender.textContent === '保密', e.signGender.textContent);
  ok('通过时间戳', /通过$/.test(e.passTime.textContent), e.passTime.textContent);
  ok('已写入 localStorage', store.size === 1);
  ok('记录里带 gender', JSON.parse(store.get('sly_gate_pass_v1')).gender === '保密');
  ok('称呼：保密 → 朋友', e.__sandbox.window.SlyApp.callName() === '朋友', e.__sandbox.window.SlyApp.callName());

  console.log('[8] 模拟刷新：应直接进站');
  const e2 = newPage();
  await sleep(50);
  ok('跳过门禁', e2.site.hidden === false && e2.gate.hidden === true);
  ok('经历还在', e2.noteText.textContent === note);

  console.log('[9] 男生 → 兄弟；女生 → 姐妹');
  ['男生', '女生'].forEach((g) => {
    const p = newPage();
    p.q1.value = 'sly';
    pickGender(p, g);
    p.q2.value = '一段只有我们知道的事';
    p.gateForm.fire('submit');
    const want = g === '男生' ? '兄弟' : '姐妹';
    ok(g + ' → ' + want, p.__sandbox.window.SlyApp.callName() === want);
  });

  console.log('[10] 进答题页：应通知 quiz 模块');
  const q = newPage();
  await sleep(50);
  q.__sandbox.window.SlyApp.go('quiz');
  await sleep(400);
  ok('quiz 显示', q.quiz.hidden === false);
  ok('onEnter 被调用', q.__calls.onEnter === 1, String(q.__calls.onEnter));

  console.log('[11] 重新上锁：回到门禁并清空');
  e2.lockBtn.fire('click');
  await sleep(500);
  ok('回到 gate', e2.gate.hidden === false && e2.site.hidden === true);
  ok('localStorage 已清', store.size === 0);
  ok('tip 复位', e2.tip.hidden === true);
  ok('性别复位', e2.genderGroup._pills.every((p) => p.getAttribute('aria-checked') === 'false'));
  e2.q1.value = '孙路遥';
  e2.gateForm.fire('submit');
  ok('上锁后仍要重新选性别', e2.genderMsg.textContent === '选一个吧，我好知道该怎么称呼你。');

  console.log(fails === 0 ? '\n全部通过 ✅' : '\n失败 ' + fails + ' 项 ❌');
  process.exit(fails === 0 ? 0 : 1);
})();
