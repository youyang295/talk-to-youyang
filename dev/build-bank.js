/* ===========================================================
   扫描 问题库/ 下的所有 .txt，生成 assets/question-bank.js
   用法：双击根目录的「更新问题库.bat」，或 node dev/build-bank.js
   -----------------------------------------------------------
   放哪儿都行，按路径里的关键词归类：
     问题库/悠阳的近况/xxx.txt   → 近况
     问题库/悠阳的爱好/xxx.txt   → 爱好
     问题库/悠阳的习惯/xxx.txt   → 习惯
   （以 "_" 或 "." 开头的文件夹会被跳过，说明.txt 也跳过）

   两种写法都认：
     A) 一行一题：  问题 || 答案 || 别的说法 || ...
     B) 两行一题：  1 问题
                    答案 答案文本
   答案后面用括号补一句吐槽，会当成"备注"显示给答题的人看：
     答案 校园跑（每天都跑，多少你别问）
   =========================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BANK_DIR = path.join(ROOT, '问题库');
const OUT = path.join(ROOT, 'assets', 'question-bank.js');

/* need = 够标准 10 题（4 + 6）所需的题量 */
const CATS = [
  { key: '近况', need: 4, words: ['近况'] },
  { key: '爱好', need: 4, words: ['爱好'] },
  { key: '习惯', need: 6, words: ['习惯'] },
];

const SKIP_NAME = /说明|模板|示例|readme/i;
const TODO_PAT = /【待填】|待填|我想不出来了|没想好|TODO/i;
const SPLIT = /\s*(?:\|\||｜｜|\||｜)\s*/;
const NUM_PREFIX = /^(?:\d{1,3}\s*[.、)）:：]\s*|\d{1,3}\s+)/;

/* ---------- 找文件 ---------- */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (SKIP_NAME.test(d.name) || d.name.startsWith('_') || d.name.startsWith('.')) return;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, out);
    else if (/\.txt$/i.test(d.name)) out.push(full);
  });
  return out;
}

function classify(file) {
  const rel = path.relative(BANK_DIR, file);
  const parts = rel.split(path.sep);
  // 先看文件夹（从里到外），再看文件名
  const segs = parts.slice(0, -1).reverse().concat(parts[parts.length - 1]);
  for (const seg of segs) {
    const hit = CATS.find((c) => c.words.some((w) => seg.includes(w)));
    if (hit) return hit.key;
  }
  return null;
}

/* ---------- 解析 ---------- */
function cleanQ(s) {
  return String(s).trim().replace(NUM_PREFIX, '').trim();
}

/* 把答案尾巴上的括号吐槽拆出来当备注 */
function splitNote(raw) {
  let s = String(raw).trim();
  let note = '';
  const m = s.match(/^([\s\S]*?)[（(]([^（）()]*)[）)]\s*$/);
  if (m && m[1].trim()) {
    s = m[1].trim();
    note = m[2].trim();
  }
  s = s.replace(/[。．.\s]+$/, '');
  return { a: s || String(raw).trim(), note };
}

function parseText(text, label) {
  const items = [];
  const problems = [];
  let pending = null; // 写了题目还没写答案

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const where = `${label} 第 ${i + 1} 行`;

    /* 答案行 */
    const am = line.match(/^答\s*案[\s：:]\s*(.+)$/);
    if (am) {
      if (!pending) {
        problems.push(`${where}：「答案」上面没有题目`);
        return;
      }
      pending.raw = am[1].trim();
      items.push(pending);
      pending = null;
      return;
    }

    /* 一行一题（|| 分隔） */
    if (/\|\||｜｜|\||｜/.test(line)) {
      if (pending) {
        problems.push(`${where} 上面那道题没写答案：${pending.q.slice(0, 20)}`);
        pending = null;
      }
      const parts = line.split(SPLIT).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) {
        problems.push(`${where}：少了答案（要用 || 分隔）: ${line.slice(0, 30)}`);
        return;
      }
      items.push({ q: cleanQ(parts[0]), raw: parts[1], alts: parts.slice(2) });
      return;
    }

    /* 普通行 = 新题目 */
    if (pending) problems.push(`${where} 上面那道题没写答案：${pending.q.slice(0, 20)}`);
    pending = { q: cleanQ(line), raw: '', alts: [] };
  });

  if (pending) problems.push(`${label} 最后一道题没写答案：${pending.q.slice(0, 20)}`);

  return {
    items: items
      .filter((it) => it.q && it.raw)
      .map((it) => {
        const { a, note } = splitNote(it.raw);
        return {
          q: it.q,
          a,
          note,
          alts: (it.alts || []).filter(Boolean),
          todo: TODO_PAT.test(it.q) || TODO_PAT.test(it.raw),
        };
      }),
    problems,
  };
}

/* ---------- 主流程 ---------- */
function main() {
  const files = walk(BANK_DIR);
  const cats = {};
  CATS.forEach((c) => (cats[c.key] = []));

  const notes = [];
  const perFile = [];
  let skipped = 0;

  files.forEach((file) => {
    const rel = path.relative(BANK_DIR, file).replace(/\\/g, '/');
    const cat = classify(file);
    if (!cat) {
      notes.push(`[${rel}] 认不出是哪个分类（路径里要有 近况 / 爱好 / 习惯），跳过了`);
      skipped++;
      return;
    }
    const res = parseText(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), rel);
    (res.problems || []).forEach((p) => notes.push(p));
    if (!res.items.length) {
      notes.push(`[${rel}] 一题都没解析出来`);
      skipped++;
      return;
    }
    cats[cat] = cats[cat].concat(res.items);
    perFile.push(`  ${cat.padEnd(3, '　')} +${String(res.items.length).padStart(2)} 题   ${rel}`);
  });

  /* 统计 */
  let total = 0;
  let todos = 0;
  let short = 0;
  const counts = {};

  CATS.forEach(({ key, need }) => {
    const all = cats[key];
    const todo = all.filter((it) => it.todo).length;
    const usable = all.length - todo;
    counts[key] = usable;
    total += usable;
    todos += todo;
    if (usable < need) short++;
  });

  /* 写文件 */
  const banner =
    '/* 本文件由 dev/build-bank.js 自动生成，别手改。\n' +
    '   改题目请编辑 问题库/ 里的 txt，然后双击「更新问题库.bat」。 */\n';
  const body =
    'window.SLY_BANK = ' +
    JSON.stringify({ generatedAt: new Date().toISOString(), placeholders: todos, total, cats }, null, 2) +
    ';\n';
  fs.writeFileSync(OUT, banner + body, 'utf8');

  /* 报告 */
  console.log('读取问题库…');
  console.log('');
  if (perFile.length) {
    console.log('  从这些文件里读到：');
    perFile.forEach((l) => console.log('  ' + l));
    console.log('');
  }
  CATS.forEach(({ key, need }) => {
    const all = cats[key];
    const todo = all.filter((it) => it.todo).length;
    console.log(
      `  ${key.padEnd(3, '　')} 可用 ${String(counts[key]).padStart(2)} 题` +
        (todo ? `（另有 ${todo} 题还没写答案，先不算）` : '') +
        (counts[key] < need ? `   ← 标准 10 题要 ${need} 题` : '')
    );
  });

  console.log('');
  notes.forEach((n) => console.log('  ! ' + n));
  if (skipped && !notes.length) console.log(`  ! 有 ${skipped} 个文件被跳过`);

  if (!counts.近况 && !counts.爱好) {
    console.log('  !! 近况和爱好都没题，答题闯关没法开始。');
    process.exitCode = 1;
  }
  if (short) {
    console.log(`  !! 有分类题量不够，答题时会自动少出几题（不会报错，补上就自动恢复）。`);
  }

  console.log(`  合计可用 ${total} 题${todos ? `，另有 ${todos} 题待填` : ''}`);
  console.log(`  已生成 → assets/question-bank.js`);
  console.log('');
  console.log('  回到浏览器按 F5 刷新，新题就进去了。');
}

main();
