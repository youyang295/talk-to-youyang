/* ===========================================================
   浏览器端 e2e 测试：无头 Edge 真跑一遍「门禁 → 答题两轮」
   跑法：node dev/e2e/run.js
   依赖：Windows 上的 Edge；不需要装任何 npm 包。
   =========================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const HERE = __dirname;
const WORK = path.join(ROOT, '.e2e-tmp'); // 必须在站内，页面才能用 ../assets/ 引用资源

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.log('没找到 Edge，跳过浏览器 e2e。');
  process.exit(0);
}

/* ---------- 1. 生成测试页 ---------- */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/"assets\//g, '"../assets/');
html = html.replace(
  '</body>',
  '<script src="../dev/e2e/bank.js"></script>\n' +
  '<script src="../dev/e2e/driver.js"></script>\n</body>'
);
fs.writeFileSync(path.join(WORK, 'e2e.html'), html);

/* ---------- 2. 无头跑一遍（stdout 直接重定向到文件，不经过管道） ---------- */
const domPath = path.join(WORK, 'dom.html');
const fd = fs.openSync(domPath, 'w');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sly-edge-'));
const res = spawnSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--user-data-dir=' + profile,
  '--virtual-time-budget=40000',
  '--dump-dom',
  'file:///' + path.join(WORK, 'e2e.html').replace(/\\/g, '/'),
], { stdio: ['ignore', fd, 'ignore'], timeout: 120000 });
fs.closeSync(fd);

const dom = fs.readFileSync(domPath, 'utf8');
const m = dom.match(/E2E_JSON_START([\s\S]*?)E2E_JSON_END/);

/* ---------- 3. 判定 ---------- */
let fails = 0;
function ok(name, cond, extra = '') {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

if (!m) {
  console.log('  FAIL  页面没有跑出结果（脚本抛错或超时）');
  console.log('        中间文件留在 ' + WORK);
  process.exit(1);
}

const o = JSON.parse(m[1]);

console.log('[1] 门禁');
ok('三题答完自动进站', o.gateHidden === true && o.siteVisible === true);
ok('称呼带上性别', o.signGender === '女生', o.signGender);
ok('经历回显', /高三那年冬天/.test(o.noteText), o.noteText);
ok('通过记录已写入', (function () {
  try {
    const rec = JSON.parse(String(o.stored));
    return rec.gender === '女生' && !!rec.note && !!rec.at;
  } catch (err) { return false; }
})(), String(o.stored).slice(0, 80));
ok('站内显示题库题量', o.cntNear === '12' && o.cntLike === '12' && o.cntHabit === '12',
  [o.cntNear, o.cntLike, o.cntHabit].join('/'));

const [r1, r2] = o.runs;
console.log('[2] 第一轮：前 7 题答对');
ok('一共 10 题', r1.qs.length === 10, String(r1.qs.length));
ok('「习惯」正好 6 题', r1.cats.filter((c) => c.includes('习惯')).length === 6);
ok('「近况」正好 4 题', r1.cats.filter((c) => c.includes('近况')).length === 4);
ok('得分 7 / 10', r1.score === 7, String(r1.score));
ok('错题回顾 3 条', r1.reviewCount === 3, String(r1.reviewCount));

console.log('[3] 第二轮：全对');
ok('一共 10 题', r2.qs.length === 10, String(r2.qs.length));
ok('得分 10 / 10', r2.score === 10, String(r2.score));
ok('分类分布 4 + 6', r2.cats.filter((c) => c.includes('近况')).length === 4 &&
  r2.cats.filter((c) => c.includes('习惯')).length === 6, r2.breakdown);

console.log('[4] 随机抽题');
ok('两轮顺序不同', o.sameQuestionOrder === false);
ok('两轮有重合但不全同', o.overlap > 0 && o.overlap < 10, String(o.overlap));

console.log('[5] 三个板子（file:// 下应该是本地模式）');
const b = o.boards || {};
ok('自动判断成本地模式', b.mode === 'local', String(b.mode));
ok('提示条写明是本地模式', /本地模式/.test(String(b.status)), String(b.status).slice(0, 30));
ok('三个板子各发出去一条', JSON.stringify(b.posted) === '[1,1,1]', JSON.stringify(b.posted));
ok('计数跟着变了', JSON.stringify(b.counts) === '["1 条","1 条","1 条"]', JSON.stringify(b.counts));
ok('署名显示出来了', (b.names || []).join('/') === '测试员/测试员/测试员', (b.names || []).join('/'));
ok('内容显示出来了', (b.texts || []).join('|').indexOf('你小子挺有意思') >= 0);
ok('空状态提示收起来了', (b.emptyHidden || []).every(Boolean), JSON.stringify(b.emptyHidden));
ok('不署名就用门禁里的称呼', b.defaultName === '一位姐妹', String(b.defaultName));
ok('留言板现在两条', b.askCount === 2, String(b.askCount));
ok('空内容发不出去', b.blankCount === 2 && /写点什么/.test(String(b.blankMsg)), String(b.blankMsg));
ok('撤回要先点两下', b.delAsk === '确定撤回？', String(b.delAsk));
ok('撤回后板子空了', b.praiseLeft === 0 && b.praiseCount === '还没有人写', b.praiseCount + ' / ' + b.praiseLeft);
ok('撤回按钮也跟着没了', b.stillMine === false, String(b.stillMine));

if (o.errors && o.errors.length) console.log('  页面报错：' + o.errors.join(' | '));

/* ---------- 4. 收尾 ---------- */
fs.rmSync(profile, { recursive: true, force: true });
if (fails === 0) fs.rmSync(WORK, { recursive: true, force: true });
else console.log('  失败时中间文件留在 ' + WORK);

console.log(fails === 0 ? '\n浏览器 e2e 全部通过 ✅' : '\n浏览器 e2e 失败 ' + fails + ' 项 ❌');
process.exit(fails === 0 ? 0 : 1);
