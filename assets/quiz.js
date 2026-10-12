/* ===========================================================
   答题闯关
   -----------------------------------------------------------
   规则：从「近况」或「爱好」里随机抽 4 题，加上「习惯」随机抽 6 题，一共 10 题。
        哪一类题不够就自动少出几题（不报错，补上题就自动恢复标准 10 题）。
        题目全部来自 问题库/ 里的 txt（经 更新问题库.bat 生成）。
   =========================================================== */

(function () {
  'use strict';

  const MAIN_CATS = ['近况', '爱好'];
  const FIXED_CAT = '习惯';
  const MAIN_N = 4;                  // 标准：主分类抽 4 题
  const FIXED_N = 6;                 // 标准：习惯固定 6 题
  const TOTAL_N = MAIN_N + FIXED_N;  // 标准一轮 10 题

  const CAT_LABEL = {
    近况: '① 悠阳的近况',
    爱好: '② 悠阳的爱好',
    习惯: '③ 悠阳的习惯',
  };

  const $ = (id) => document.getElementById(id);

  /* ---------------- 状态 ---------------- */
  let chosen = null;   // '近况' | '爱好'
  let queue = [];      // 这一轮的题
  let idx = 0;         // 当前第几题（0 起）
  let score = 0;
  let log = [];        // 每题结果
  let answered = false;
  let usedHint = false;

  /* ---------------- 题库 ---------------- */
  function bank() {
    return (window.SLY_BANK && window.SLY_BANK.cats) || {};
  }

  /* 还没写答案的题（生成题库时打了 todo 标记）不会出给答题的人 */
  function pool(cat) {
    return (bank()[cat] || []).filter((it) => it && it.q && it.a && !it.todo);
  }

  /* 这一轮实际会出几题：习惯不够 6 题就用主分类补满 10 题 */
  function planCounts(cat) {
    const fixedN = Math.min(FIXED_N, pool(FIXED_CAT).length);
    const mainN = Math.min(pool(cat).length, Math.max(TOTAL_N - fixedN, 0));
    return { mainN, fixedN, total: mainN + fixedN };
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ---------------- 判分 ---------------- */
  function normalize(str) {
    return String(str || '')
      .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\s\u3000]/g, '')
      .replace(/[，。！？、,.!?;；:：'"“”‘’（）()【】\[\]—－-]/g, '')
      .toLowerCase();
  }

  /* 编辑距离：用来判断「差不多」 */
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev;
      prev = cur;
      cur = t;
    }
    return prev[n];
  }

  /* 像不像：0~1，1 = 一模一样 */
  function similar(a, b) {
    if (!a || !b) return 0;
    const long = Math.max(a.length, b.length);
    if (long < 2) return a === b ? 1 : 0;
    return 1 - levenshtein(a, b) / long;
  }

  const CLOSE_AT = 0.5;   // 像到这个程度就按「差不多」算，给 0.5 分

  /* 判分：1 = 对；0.5 = 差不多，我不敢下结论；0 = 差太远 */
  function judge(input, item) {
    const v = normalize(input);
    if (!v) return { score: 0, how: 'empty' };
    const cands = [item.a].concat(item.alts || []).map(normalize).filter(Boolean);
    let best = 0;
    cands.forEach((n) => {
      if (n === v) best = 1;                            // 一模一样
      else if (n.length >= 2 && v.includes(n)) best = 1; // 写在句子里也算对
      else if (v.length >= 2 && n.includes(v)) best = 1; // 只写了答案的一部分也算对
      else best = Math.max(best, similar(v, n) >= CLOSE_AT ? 0.5 : 0);
    });
    if (best >= 1) return { score: 1, how: 'exact' };
    if (best >= 0.5) return { score: 0.5, how: 'close' };
    return { score: 0, how: 'wrong' };
  }

  const fmt = (n) => String(Math.round(n * 10) / 10);   // 4.5 分要显示成 4.5

  /* 正确答案 + 别的说法 + 作者备注（答案后面括号里那句） */
  function answerHtml(item) {
    const alts = (item.alts || []).filter(Boolean);
    let s = '<b>' + escapeHtml(item.a) + '</b>';
    if (alts.length) s += '（' + escapeHtml(alts.join('、')) + '）';
    if (item.note) s += ' <span class="fb-note">（' + escapeHtml(item.note) + '）</span>';
    return s;
  }

  /* ---------------- 视图切换（答题卡内部） ---------------- */
  const VIEWS = ['quizPick', 'quizPlay', 'quizResult'];

  function view(id) {
    VIEWS.forEach((v) => {
      const el = $(v);
      if (el) el.hidden = v !== id;
    });
    window.scrollTo({ top: 0 });
  }

  /* ---------------- 选题页 ---------------- */
  function refreshEntry() {
    const counts = { 近况: pool('近况').length, 爱好: pool('爱好').length, 习惯: pool(FIXED_CAT).length };

    ['近况', '爱好', '习惯'].forEach((c) => {
      const el = $('cnt' + c);
      if (el) el.textContent = counts[c];
    });

    const stamp = $('bankStamp');
    if (stamp) {
      stamp.textContent = window.SLY_BANK
        ? `题库共 ${counts.近况 + counts.爱好 + counts.习惯} 题`
        : '题库未生成';
    }

    document.querySelectorAll('.pick').forEach((btn) => {
      const cat = btn.dataset.cat;
      const n = counts[cat];
      const badge = btn.querySelector('.pick-count');
      if (badge) badge.textContent = n ? `题库 ${n} 题` : '题库空着';
      const meta = btn.querySelector('.pick-meta');
      if (meta) {
        meta.textContent =
          (cat === '近况' ? '最近的生活' : '喜欢的东西') + ` · 抽 ${planCounts(cat).mainN} 题`;
      }
      btn.dataset.disabled = n ? '0' : '1';
    });

    const fixedNote = document.querySelector('.fixed-note');
    if (fixedNote) {
      const fn = planCounts('近况').fixedN;
      fixedNote.textContent = fn < FIXED_N
        ? `固定 ${fn} 题（题库里只有 ${fn} 题）`
        : `固定 ${fn} 题，选谁都躲不掉`;
    }

    // 提醒
    const warn = $('bankWarn');
    if (warn) {
      const msgs = [];
      if (!counts.近况 && !counts.爱好) {
        msgs.push('题库是空的：去「问题库」文件夹里填题，再双击「更新问题库.bat」。');
      }
      if (counts[FIXED_CAT] < FIXED_N) {
        msgs.push(
          `「习惯」只有 ${counts[FIXED_CAT]} 题，凑不满 6 题，这一轮就先出 ${counts[FIXED_CAT]} 题；` +
            `再补 ${FIXED_N - counts[FIXED_CAT]} 题就是标准 10 题了。`
        );
      }
      if (window.SLY_BANK && window.SLY_BANK.placeholders) {
        msgs.push(`题库里还有 ${window.SLY_BANK.placeholders} 题没写答案，先跳过了。`);
      }
      warn.textContent = msgs.join(' ');
      warn.hidden = msgs.length === 0;
    }
  }

  function choose(cat) {
    chosen = cat;
    document.querySelectorAll('.pick').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.cat === cat));
    });
    const btn = $('startBtn');
    btn.disabled = false;
    $('startBtnText').textContent = `从「${cat}」开始 · 共 ${planCounts(cat).total} 题`;
  }

  function resetPick() {
    chosen = null;
    document.querySelectorAll('.pick').forEach((btn) => btn.setAttribute('aria-pressed', 'false'));
    const btn = $('startBtn');
    if (btn) btn.disabled = true;
    const t = $('startBtnText');
    if (t) t.textContent = '先选一条线';
    refreshEntry();
    view('quizPick');
  }

  /* ---------------- 开始一轮 ---------------- */
  function start(cat) {
    const p = planCounts(cat);
    const main = shuffle(pool(cat).slice()).slice(0, p.mainN).map((it) => ({ ...it, cat }));
    const fixed = shuffle(pool(FIXED_CAT).slice()).slice(0, p.fixedN).map((it) => ({ ...it, cat: FIXED_CAT }));
    queue = shuffle(main.concat(fixed));

    if (!queue.length) {
      resetPick();
      return;
    }

    idx = 0;
    score = 0;
    log = [];
    view('quizPlay');
    render();
  }

  /* ---------------- 渲染当前题 ---------------- */
  function render() {
    const it = queue[idx];
    answered = false;
    usedHint = false;

    $('qCat').textContent = CAT_LABEL[it.cat] || it.cat;
    $('qCounter').textContent = `第 ${idx + 1} / ${queue.length} 题`;
    $('qScore').textContent = `${score} 分`;
    $('qText').textContent = it.q;
    $('qBar').style.width = (idx / queue.length) * 100 + '%';

    const input = $('qInput');
    input.value = '';
    input.disabled = false;
    input.placeholder = '写下你的答案，回车提交';

    setMsg(null, '');
    $('qField').classList.remove('error', 'ok');

    $('qFeedback').hidden = true;
    $('qFeedback').className = 'feedback';
    $('qSubmit').textContent = '提交';
    $('qSubmit').disabled = false;
    $('qHint').disabled = false;
    $('qSkip').disabled = false;

    setTimeout(() => input.focus(), 120);
  }

  function setMsg(type, text) {
    const msg = $('qMsg');
    const field = $('qField');
    field.classList.remove('error', 'ok');
    msg.classList.remove('show');
    if (!type) return;
    field.classList.add(type === 'error' ? 'error' : 'ok');
    msg.textContent = text;
    void msg.offsetWidth;
    msg.classList.add('show');
  }

  /* ---------------- 提交 / 跳过 ---------------- */
  function submit() {
    if (answered) return next();

    const it = queue[idx];
    const val = $('qInput').value.trim();
    if (!val) {
      setMsg('error', '写点什么再交呀，实在不会可以点「跳过」。');
      $('qInput').focus();
      return;
    }
    settle(val, judge(val, it));
  }

  function skip() {
    if (answered) return;
    settle('', { score: 0, how: 'skip' }, true);
  }

  function settle(mine, verdict, skipped) {
    const it = queue[idx];
    answered = true;
    const half = verdict.score === 0.5;

    score += verdict.score;
    log.push({
      cat: it.cat, q: it.q, a: it.a, alts: it.alts || [], note: it.note || '',
      mine, right: verdict.score === 1, score: verdict.score, how: verdict.how,
      skipped: !!skipped, hinted: usedHint,
    });

    $('qInput').disabled = true;
    $('qScore').textContent = `${fmt(score)} 分`;
    $('qBar').style.width = ((idx + 1) / queue.length) * 100 + '%';
    $('qHint').disabled = true;
    $('qSkip').disabled = true;

    const fb = $('qFeedback');
    fb.hidden = false;
    if (verdict.score === 1) {
      fb.className = 'feedback right';
      $('fbHead').textContent = '答对了  +1';
      $('fbAnswer').innerHTML = '正确答案：' + answerHtml(it);
      setMsg('ok', '');
    } else {
      fb.className = 'feedback ' + (half ? 'half' : 'wrong');
      $('fbHead').textContent = skipped ? '这题先放着' : half ? '差不多  +0.5' : '差一点';
      $('fbAnswer').innerHTML =
        '正确答案：' + answerHtml(it) +
        (mine ? `<br />你写的是：<s>${escapeHtml(mine)}</s>` : '') +
        (half ? '<br /><span class="fb-ask">等我问问悠阳这个对不对</span>' : '');
      if (!skipped && !half) setMsg('error', '');
    }

    $('qSubmit').textContent = idx + 1 >= queue.length ? '看结果 →' : '下一题 →';
    $('qSubmit').disabled = false;
    $('qSubmit').focus();
  }

  function next() {
    idx += 1;
    if (idx >= queue.length) finish();
    else render();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 结果 ---------------- */
  function comment(score, total) {
    const p = total ? score / total : 0;
    if (p === 1) return '满分。你是不是比我自己还了解我？';
    if (p >= 0.8) return '很可以，是能坐下来聊很久的那种人。';
    if (p >= 0.6) return '及格线以上，算你半个熟人。';
    if (p >= 0.4) return '……你是不是只记得我的名字？';
    if (p > 0) return '嗯，至少你还知道我是谁。';
    return '你是不是走错门了？';
  }

  function finish() {
    const total = queue.length;
    view('quizResult');

    $('rScore').textContent = fmt(score);
    $('rTotal').textContent = '/' + total;
    const call = window.SlyApp ? window.SlyApp.callName() : '朋友';
    $('rComment').textContent = `${call}，${comment(score, total)}`;

    // 分项
    const byCat = {};
    log.forEach((l) => {
      byCat[l.cat] = byCat[l.cat] || { right: 0, n: 0 };
      byCat[l.cat].n += 1;
      byCat[l.cat].right += l.score;
    });
    $('rBreakdown').innerHTML = Object.keys(byCat)
      .map((cat) => {
        const d = byCat[cat];
        return (
          `<div class="bd-item"><div class="bd-name">${escapeHtml(CAT_LABEL[cat] || cat)}</div>` +
          `<div class="bd-val">${fmt(d.right)}<em> / ${d.n} 题</em></div></div>`
        );
      })
      .join('');

    // 没拿到满分的题：0 分是错题，0.5 分是我不敢下结论的
    const rest = log.filter((l) => l.score < 1);
    const halfN = log.filter((l) => l.score === 0.5).length;
    $('rReview').innerHTML = rest.length
      ? (halfN && halfN < rest.length
          ? `<li class="review-tip">有 ${halfN} 题我觉得「差不多」，先给了 0.5 分 —— 等我问问悠阳这个对不对。</li>`
          : '') +
        rest
          .map((l) => {
            const half = l.score === 0.5;
            return (
              `<li class="${l.skipped ? 'skip' : half ? 'half' : ''}">` +
              `<div class="rq">${escapeHtml(l.q)}` +
              (half ? '<span class="rbadge">0.5 分</span>' : '') + '</div>' +
              `<div class="ra">正确答案：${answerHtml(l)}` +
              (l.skipped ? '（跳过了）' : `　你写的：<span class="rmine">${escapeHtml(l.mine)}</span>`) +
              (half ? '<br /><span class="fb-ask">等我问问悠阳这个对不对</span>' : '') +
              `</div></li>`
            );
          })
          .join('')
      : '<li class="empty">全对，没有错题。</li>';

    $('againBtn').textContent = `再来一批（还是「${chosen || ''}」）`;
  }

  /* ---------------- 事件 ---------------- */
  document.querySelectorAll('.pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.disabled === '1') return;
      choose(btn.dataset.cat);
    });
  });

  $('startBtn').addEventListener('click', () => { if (chosen) start(chosen); });
  $('qSubmit').addEventListener('click', submit);
  $('qSkip').addEventListener('click', skip);
  $('qInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  $('qInput').addEventListener('input', () => { if (!answered) setMsg(null, ''); });

  $('qHint').addEventListener('click', () => {
    if (answered) return;
    const it = queue[idx];
    usedHint = true;
    const a = String(it.a);
    setMsg(null, '');
    $('qMsg').textContent =
      a.length <= 1
        ? '提示：答案就一个字，凭直觉来吧。'
        : `提示：答案一共 ${a.length} 个字，第一个字是「${a[0]}」。` +
          (it.note ? `（作者留言：${it.note}）` : '');
    $('qMsg').classList.add('show');
  });

  $('againBtn').addEventListener('click', () => { if (chosen) start(chosen); });
  $('switchBtn').addEventListener('click', resetPick);
  $('homeBtn').addEventListener('click', () => window.SlyApp && window.SlyApp.go('site'));
  $('pickBack').addEventListener('click', () => window.SlyApp && window.SlyApp.go('site'));
  $('playQuit').addEventListener('click', resetPick);

  $('toQuizBtn').addEventListener('click', () => window.SlyApp && window.SlyApp.go('quiz'));

  /* ---------------- 对外 ---------------- */
  window.SlyQuiz = {
    onEnter: resetPick,
    refresh: refreshEntry,
  };

  refreshEntry();
})();
