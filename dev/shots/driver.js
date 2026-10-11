/* ===========================================================
   截图驱动器：按地址栏 #gate|#site|#pick|#play|#result 停在对应界面，
   顺便把关键文案塞进 <pre id="e2e-out">，方便 --dump-dom 检查。
   由 dev/shots/run.js 自动挂进生成页，不用手动引用。
   =========================================================== */
(function () {
  const log = { stop: (location.hash || '').replace('#', '') };
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function answerOf(q) {
    const cats = (window.SLY_BANK && window.SLY_BANK.cats) || {};
    for (const c of Object.keys(cats)) {
      const hit = cats[c].find((it) => it.q === q);
      if (hit) return hit.a;
    }
    return '';
  }

  function setVal(el, v) {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submitForm(form) {
    if (form.requestSubmit) form.requestSubmit();
    else form.querySelector('button[type="submit"]').click();
  }

  /* 往三个板子里灌几条像样的留言，好让截图不空 */
  const SAMPLE = {
    ask: [
      ['你最近还跑步吗？', '一位姐妹'],
      ['你是怎么想起来做这个网站的？', '老朋友'],
    ],
    idea: [
      ['能不能加个夜间模式？', '路过的同学'],
      ['手机上按钮有点小，能不能大一点', '保密'],
    ],
    praise: [
      ['你小子有点东西，这网站我玩了三遍。', '高中同桌'],
      ['没想到你还有这一手，必须夸', '一位兄弟'],
    ],
  };

  async function seedBoards() {
    for (let i = 0; i < 40; i++) {
      if (window.SlyBoard && window.SlyBoard.ready) break;
      await sleep(150);
    }
    for (const kind of Object.keys(SAMPLE)) {
      const box = document.querySelector('.board[data-kind="' + kind + '"]');
      if (!box) continue;
      for (const pair of SAMPLE[kind]) {
        setVal(box.querySelector('[data-role="text"]'), pair[0]);
        setVal(box.querySelector('[data-role="name"]'), pair[1]);
        submitForm(box.querySelector('[data-role="form"]'));
        await sleep(220);
      }
    }
  }

  function boardFacts() {
    const out = { mode: window.SlyBoard ? window.SlyBoard.mode : '(没有 SlyBoard)', status: '' };
    const st = $('boardStatus');
    out.status = st ? st.textContent.replace(/\s+/g, ' ').trim() : '';
    out.kinds = ['ask', 'idea', 'praise'].map((k) => {
      const box = document.querySelector('.board[data-kind="' + k + '"]');
      if (!box) return '(没有这块)';
      const items = box.querySelectorAll('.board-item');
      return box.querySelector('[data-role="count"]').textContent + ' · ' + items.length + ' 条' +
        (items[0] ? ' · 最新：' + items[0].querySelector('.bi-name').textContent + '｜' + items[0].querySelector('.bi-text').textContent : '');
    });
    return out;
  }

  function facts(extra) {
    const pick = document.querySelector('.pick[data-cat="近况"]');
    return Object.assign(
      {
        startText: $('startBtnText') ? $('startBtnText').textContent : '',
        bankWarn: $('bankWarn') && !$('bankWarn').hidden ? $('bankWarn').textContent : '(隐藏)',
        pickMeta: pick && pick.querySelector('.pick-meta') ? pick.querySelector('.pick-meta').textContent : '',
        fixedNote: document.querySelector('.fixed-note') ? document.querySelector('.fixed-note').textContent : '',
        counts: [$('cnt近况').textContent, $('cnt爱好').textContent, $('cnt习惯').textContent].join('/'),
      },
      extra || {}
    );
  }

  async function play(rightCount, skipLast) {
    const seen = [];
    window.SlyApp.go('quiz');
    await sleep(700);
    document.querySelector('.pick[data-cat="近况"]').click();
    await sleep(80);
    $('startBtn').click();
    await sleep(300);

    if (log.stop === 'play') {
      const q = $('qText').textContent;
      setVal($('qInput'), answerOf(q));
      $('qSubmit').click();
      await sleep(400);
      log.facts = facts({ firstQ: q, feedback: $('fbAnswer').innerText.replace(/\s+/g, ' ').trim() });
      return;
    }

    for (let i = 0; i < 60; i++) {
      if (!$('quizResult').hidden) break;
      if ($('quizPlay').hidden) { await sleep(120); continue; }
      const input = $('qInput');
      if (input.disabled) { $('qSubmit').click(); await sleep(120); continue; }
      const q = $('qText').textContent;
      const done = seen.length;
      seen.push($('qCat').textContent);
      if (skipLast && done === 1) $('qSkip').click();
      else setVal(input, done < rightCount ? answerOf(q) : '想不起来了' + done);
      $('qSubmit').click();
      await sleep(140);
    }

    log.facts = facts({
      total: $('rTotal').textContent,
      score: $('rScore').textContent,
      comment: $('rComment').textContent,
      breakdown: $('rBreakdown').innerText.replace(/\s+/g, ' ').trim(),
      reviewCount: $('rReview').querySelectorAll('li').length,
    });
  }

  (async function main() {
    try {
      await sleep(250);
      if (log.stop === 'site') {
        log.facts = facts({ signGender: $('signGender').textContent, note: $('noteText').textContent });
      } else if (log.stop === 'pick') {
        window.SlyApp.go('quiz');
        await sleep(700);
        log.facts = facts();
      } else if (log.stop === 'play') {
        await play(99);
      } else if (log.stop === 'result') {
        await play(3, true); // 答对 3 题、跳过 1 题，其余算错 → 看得到错题回顾
      } else if (log.stop === 'boards' || log.stop === 'boards-full') {
        await sleep(300);
        if (log.stop === 'boards-full') await seedBoards();
        await sleep(300);
        log.facts = boardFacts();
      }
    } catch (e) {
      log.error = String((e && e.stack) || e);
    }
    const pre = document.createElement('pre');
    pre.id = 'e2e-out';
    pre.textContent = 'E2E_JSON_START' + JSON.stringify(log) + 'E2E_JSON_END';
    document.body.appendChild(pre);
    document.title = 'SHOT-DONE';
  })();
})();
