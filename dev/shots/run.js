/* ===========================================================
   用真题库给网站拍一套界面图（无头 Edge，不需要装 npm 包）
   跑法：node dev/shots/run.js
   产物：dev/预览图/*.png（1280x1180），中间文件放在站内 .shots-tmp（跑完删掉）
   =========================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const WORK = path.join(ROOT, '.shots-tmp');   // 必须在站内，页面才能用 ../assets/
const OUT = path.join(ROOT, 'dev', '预览图');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.log('没找到 Edge，跳过截图。');
  process.exit(0);
}

const SEED = `<script>
try {
  localStorage.setItem('sly_gate_pass_v1', JSON.stringify({
    note: '高三那年冬天，你把外套扔给我就跑了，我到现在都没还你。',
    gender: '女生',
    at: Date.parse('2026-10-11T21:49:00')
  }));
} catch (e) {}
</script>
`;

const STOPS = [
  { hash: 'gate', page: 'gate', out: '1-门禁.png' },
  { hash: 'site', page: 'in', out: '2-主站.png' },
  { hash: 'pick', page: 'in', out: '3-选题.png' },
  { hash: 'play', page: 'in', out: '4-答题.png' },
  { hash: 'result', page: 'in', out: '5-结果.png' },
  { hash: 'boards', page: 'in', out: '6-板子-空的.png', h: 2900 },
  { hash: 'boards-full', page: 'in', out: '7-板子-有人留言.png', h: 2900 },
];

/* ---------- 1. 生成两张测试页：没通过门禁的 / 已通过的 ---------- */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

let base = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
base = base.replace(/"assets\//g, '"../assets/');
const withDriver = (h) =>
  h.replace('</body>', '<script src="../dev/shots/driver.js"></script>\n</body>');

fs.writeFileSync(path.join(WORK, 'gate.html'), withDriver(base));
fs.writeFileSync(
  path.join(WORK, 'in.html'),
  withDriver(base.replace('<script src="../assets/question-bank.js">', SEED + '<script src="../assets/question-bank.js">'))
);

function fileUrl(page) {
  return 'file:///' + path.join(WORK, page + '.html').replace(/\\/g, '/');
}

/* ---------- 2. 逐屏截图（stdout/stderr 不进管道，避开沙箱 EPERM） ---------- */
for (const stop of STOPS) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sly-shot-'));
  const fd = fs.openSync(path.join(WORK, 'log.txt'), 'w');
  spawnSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--user-data-dir=' + profile,
    '--window-size=1280,' + (stop.h || 1180),
    '--virtual-time-budget=15000',
    '--screenshot=' + path.join(OUT, stop.out),
    fileUrl(stop.page) + '#' + stop.hash,
  ], { stdio: ['ignore', fd, 'ignore'], timeout: 120000 });
  fs.closeSync(fd);
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('  拍好  dev/预览图/' + stop.out + '  ← #' + stop.hash);
}

/* ---------- 3. 顺便把真题库的实际文案 dump 出来看一眼 ---------- */
const domPath = path.join(WORK, 'dom.html');
const fd2 = fs.openSync(domPath, 'w');
const profile2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sly-dom-'));
spawnSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + profile2,
  '--virtual-time-budget=15000',
  '--dump-dom',
  fileUrl('in') + '#pick',
], { stdio: ['ignore', fd2, 'ignore'], timeout: 120000 });
fs.closeSync(fd2);
fs.rmSync(profile2, { recursive: true, force: true });

const m = fs.readFileSync(domPath, 'utf8').match(/E2E_JSON_START([\s\S]*?)E2E_JSON_END/);
if (m) {
  const o = JSON.parse(m[1]);
  const f = o.facts || {};
  console.log('\n真题库现状（选题页）');
  console.log('  站内题量 近况/爱好/习惯 = ' + f.counts);
  console.log('  分类卡    ' + f.pickMeta);
  console.log('  固定项    ' + f.fixedNote);
  console.log('  开始按钮  ' + f.startText);
  console.log('  提醒      ' + f.bankWarn);
  if (o.error) console.log('  页面报错：' + o.error);
} else {
  console.log('\n没能读到页面数据，中间文件留在 ' + WORK);
  process.exit(1);
}

/* ---------- 4. 顺便看一眼三个板子到底显示成什么样 ---------- */
const domPath2 = path.join(WORK, 'dom2.html');
const fd3 = fs.openSync(domPath2, 'w');
const profile3 = fs.mkdtempSync(path.join(os.tmpdir(), 'sly-dom-'));
spawnSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + profile3,
  '--virtual-time-budget=20000',
  '--dump-dom',
  fileUrl('in') + '#boards-full',
], { stdio: ['ignore', fd3, 'ignore'], timeout: 120000 });
fs.closeSync(fd3);
fs.rmSync(profile3, { recursive: true, force: true });

const m2 = fs.readFileSync(domPath2, 'utf8').match(/E2E_JSON_START([\s\S]*?)E2E_JSON_END/);
if (m2) {
  const f = (JSON.parse(m2[1]).facts) || {};
  console.log('\n板子现状（' + f.mode + '）');
  console.log('  ' + f.status);
  (f.kinds || []).forEach((line, i) => console.log('  ' + ['留言板', '改进建议', '夸夸板'][i] + '  ' + line));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log('\n界面图拍完了 ✅  dev/预览图/');
