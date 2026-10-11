/* ===========================================================
   关于 sly 的有趣问答  ·  门禁 + 舞台切换
   -----------------------------------------------------------
   想改答案 / 改提示语，只改下面这个 CONFIG 就够了。
   =========================================================== */

const CONFIG = {
  /* 第 1 题的正确答案（多个都算对；比较时会忽略空格、标点和大小写） */
  answers: ['孙路遥', 'sly'],

  /* 答错时的提示语 */
  wrongText: '小坏蛋快去私信问问我',

  /* 答错几次之后，给一句小提示 */
  hintAfter: 3,
  hintText: '提示：是我名字的中文全名，三个字，姓孙。 —— 还猜不到就真的来问我吧。',

  /* 性别没选时的提示 */
  genderText: '选一个吧，我好知道该怎么称呼你。',

  /* 第 2 题：答案随意，但不能空着 */
  emptyQ2Text: '这条得写点什么吧，不然我怎么知道你是谁～',
  okQ2Text: '好，我记下了。',

  /* 通过之后在本机记住，下次进来不用再答 */
  remember: true,
  storeKey: 'sly_gate_pass_v1'
};

/* ---------------- 元素 ---------------- */
const gate     = document.getElementById('gate');
const gateCard = document.getElementById('gateCard');
const site     = document.getElementById('site');
const quiz     = document.getElementById('quiz');
const form     = document.getElementById('gateForm');
const q1       = document.getElementById('q1');
const q2       = document.getElementById('q2');
const q1Msg    = document.getElementById('q1Msg');
const q2Msg    = document.getElementById('q2Msg');
const genderMsg = document.getElementById('genderMsg');
const genderGroup = document.getElementById('genderGroup');
const field1   = document.getElementById('field1');
const field2   = document.getElementById('field2');
const fieldG   = document.getElementById('fieldG');
const tip      = document.getElementById('tip');
const enterBtn = document.getElementById('enterBtn');
const lockBtn  = document.getElementById('lockBtn');
const noteText = document.getElementById('noteText');
const passTime = document.getElementById('passTime');
const signGender = document.getElementById('signGender');
const yearEl   = document.getElementById('year');

let wrongCount = 0;
let gender = '';
let pass = null; // { note, gender, at }

/* ---------------- 小工具 ---------------- */
function normalize(str) {
  return String(str || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)) // 全角转半角
    .replace(/[\s\u3000]/g, '')                                   // 去掉所有空白
    .replace(/[，。！？、,.!?;；:：'"“”‘’（）()【】\[\]—－-]/g, '') // 去掉标点
    .toLowerCase();
}

function isCorrect(str) {
  const v = normalize(str);
  if (!v) return false;
  return CONFIG.answers.some((a) => normalize(a) === v);
}

function setState(field, msgEl, type, text) {
  field.classList.remove('error', 'ok');
  msgEl.classList.remove('show');
  if (!type) return;
  field.classList.add(type);
  msgEl.textContent = text;
  void msgEl.offsetWidth; // 重新触发入场动画
  msgEl.classList.add('show');
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 520);
}

function showTip(text) {
  tip.textContent = text;
  tip.hidden = false;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function callName() {
  if (gender === '男生') return '兄弟';
  if (gender === '女生') return '姐妹';
  return '朋友';
}

/* ---------------- 本地存取 ---------------- */
function savePass(rec) {
  try { localStorage.setItem(CONFIG.storeKey, JSON.stringify(rec)); } catch (e) { /* 隐私模式，忽略 */ }
}

function loadPass() {
  try {
    const raw = localStorage.getItem(CONFIG.storeKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearPass() {
  try { localStorage.removeItem(CONFIG.storeKey); } catch (e) {}
}

/* ---------------- 舞台切换 ---------------- */
const STAGE_IDS = ['gate', 'site', 'quiz'];

function go(name) {
  const next = document.getElementById(name);
  if (!next) return;
  const cur = STAGE_IDS.map((id) => document.getElementById(id)).find((el) => el && !el.hidden);
  if (cur === next) return;

  const reveal = () => {
    if (cur) { cur.hidden = true; cur.classList.remove('fade-out'); }
    next.hidden = false;
    next.classList.add('fade-in');
    window.scrollTo({ top: 0 });
    setTimeout(() => next.classList.remove('fade-in'), 700);
    if (name === 'quiz' && window.SlyQuiz) window.SlyQuiz.onEnter();
  };

  if (cur) { cur.classList.add('fade-out'); setTimeout(reveal, 300); }
  else reveal();
}

/* ---------------- 站内信息 ---------------- */
function fillSite(rec) {
  noteText.textContent = rec.note || '（这次没留话，下次补上）';
  passTime.textContent = rec.at ? fmtTime(rec.at) + ' 通过' : '刚刚通过';
  signGender.textContent = rec.gender || ''; // 保密也照写，是访客自己选的
}

function enterSite(rec) {
  pass = rec;
  gender = rec.gender || gender;
  fillSite(rec);
  go('site');
}

/* ---------------- 门禁交互 ---------------- */
q1.addEventListener('input', () => setState(field1, q1Msg, null, ''));
q2.addEventListener('input', () => setState(field2, q2Msg, null, ''));

genderGroup.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  gender = pill.dataset.value;
  genderGroup.querySelectorAll('.pill').forEach((p) => {
    p.setAttribute('aria-checked', String(p === pill));
  });
  setState(fieldG, genderMsg, null, '');
});

q1.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (isCorrect(q1.value)) {
    setState(field1, q1Msg, 'ok', '嗯，是我。');
    q2.focus();
  } else {
    form.requestSubmit();
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();

  /* ---- 第 1 题：全名 ---- */
  if (!isCorrect(q1.value)) {
    wrongCount += 1;
    setState(field1, q1Msg, 'error', CONFIG.wrongText);
    shake(gateCard);
    q1.focus();
    q1.select();
    if (wrongCount >= CONFIG.hintAfter) showTip(CONFIG.hintText);
    return;
  }
  setState(field1, q1Msg, 'ok', '嗯，是我。');

  /* ---- 第 2 题：性别 ---- */
  if (!gender) {
    setState(fieldG, genderMsg, 'error', CONFIG.genderText);
    shake(gateCard);
    return;
  }
  setState(fieldG, genderMsg, 'ok', '记下了。');

  /* ---- 第 3 题：经历 ---- */
  const note = q2.value.trim();
  if (!note) {
    setState(field2, q2Msg, 'error', CONFIG.emptyQ2Text);
    q2.focus();
    return;
  }
  setState(field2, q2Msg, 'ok', CONFIG.okQ2Text);

  /* ---- 放行 ---- */
  const rec = { note, gender, at: Date.now() };
  enterBtn.disabled = true;
  if (CONFIG.remember) savePass(rec);
  setTimeout(() => {
    enterBtn.disabled = false;
    enterSite(rec);
  }, 420);
});

lockBtn.addEventListener('click', () => {
  clearPass();
  wrongCount = 0;
  pass = null;
  gender = '';
  form.reset();
  genderGroup.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-checked', 'false'));
  setState(field1, q1Msg, null, '');
  setState(field2, q2Msg, null, '');
  setState(fieldG, genderMsg, null, '');
  tip.hidden = true;
  go('gate');
  setTimeout(() => q1.focus(), 400);
});

/* ---------------- 对外接口 ---------------- */
window.SlyApp = {
  go,
  callName: () => callName(),
  get pass() { return pass; },
};

/* ---------------- 初始化 ---------------- */
yearEl.textContent = new Date().getFullYear();

(function init() {
  const saved = CONFIG.remember ? loadPass() : null;
  if (saved) {
    pass = saved;
    gender = saved.gender || '';
    fillSite(saved);
    gate.hidden = true;
    site.hidden = false;
    site.classList.add('fade-in');
    setTimeout(() => site.classList.remove('fade-in'), 700);
  } else {
    setTimeout(() => q1.focus(), 260);
  }
})();
