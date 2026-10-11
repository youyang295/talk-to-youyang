/* e2e 驱动器：在真实浏览器里走完「门禁 → 答题两轮」，把结果写成 JSON 放进 #e2e-out */
(function () {
  const log = { runs: [], errors: [] };
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function finish() {
    const pre = document.createElement('pre');
    pre.id = 'e2e-out';
    pre.textContent = 'E2E_JSON_START' + JSON.stringify(log) + 'E2E_JSON_END';
    document.body.appendChild(pre);
    document.title = 'E2E-DONE';
  }

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

  /* 三个板子：在 file:// 下应该自动走「本地模式」 */
  async function testBoards() {
    const out = { mode: '', status: '', posted: [], counts: [], names: [], texts: [], emptyHidden: [] };

    for (let i = 0; i < 40; i++) {
      if (window.SlyBoard && window.SlyBoard.ready) break;
      await sleep(150);
    }
    out.mode = window.SlyBoard ? window.SlyBoard.mode : '(没有 SlyBoard)';
    out.status = $('boardStatus').textContent;

    const plan = [['ask', '你平时几点睡？'], ['idea', '提示能不能再含蓄点'], ['praise', '你小子挺有意思']];
    for (const [kind, text] of plan) {
      const box = document.querySelector('.board[data-kind="' + kind + '"]');
      setVal(box.querySelector('[data-role="text"]'), text);
      setVal(box.querySelector('[data-role="name"]'), '测试员');
      submitForm(box.querySelector('[data-role="form"]'));
      await sleep(260);
      out.posted.push(box.querySelectorAll('.board-item').length);
      out.counts.push(box.querySelector('[data-role="count"]').textContent);
      out.names.push(box.querySelector('.bi-name') ? box.querySelector('.bi-name').textContent : '');
      out.texts.push(box.querySelector('.bi-text') ? box.querySelector('.bi-text').textContent : '');
      out.emptyHidden.push(box.querySelector('[data-role="empty"]').hidden);
    }

    /* 不写署名时，应该用门禁里选的性别来称呼 */
    const ask = document.querySelector('.board[data-kind="ask"]');
    setVal(ask.querySelector('[data-role="text"]'), '不署名的第二条');
    setVal(ask.querySelector('[data-role="name"]'), '');
    submitForm(ask.querySelector('[data-role="form"]'));
    await sleep(260);
    out.defaultName = ask.querySelectorAll('.bi-name')[0].textContent;
    out.askCount = ask.querySelectorAll('.board-item').length;

    /* 空内容不该发出去 */
    setVal(ask.querySelector('[data-role="text"]'), '   ');
    submitForm(ask.querySelector('[data-role="form"]'));
    await sleep(160);
    out.blankMsg = ask.querySelector('[data-role="msg"]').textContent;
    out.blankCount = ask.querySelectorAll('.board-item').length;

    /* 撤回要点两下：第一下变成「确定撤回？」 */
    const praise = document.querySelector('.board[data-kind="praise"]');
    const del = praise.querySelector('.bi-del');
    if (del) {
      del.click();
      await sleep(60);
      out.delAsk = del.textContent;
      del.click();
      await sleep(300);
    }
    out.praiseLeft = praise.querySelectorAll('.board-item').length;
    out.praiseCount = praise.querySelector('[data-role="count"]').textContent;
    out.stillMine = !!praise.querySelector('.bi-del');
    return out;
  }

  async function passGate() {
    setVal($('q1'), '孙路遥');
    document.querySelector('.pill[data-value="女生"]').click();
    setVal($('q2'), 'E2E 那条经历：高三那年冬天你把外套扔给我就跑了。');
    $('enterBtn').click();
    await sleep(1200);
    log.gateHidden = $('gate').hidden;
    log.siteVisible = !$('site').hidden;
    log.signGender = $('signGender').textContent;
    log.passTime = $('passTime').textContent;
    log.noteText = $('noteText').textContent;
    log.stored = (function () {
      try { return localStorage.getItem('sly_gate_pass_v1'); } catch (e) { return 'ERR ' + e; }
    })();
  }

  async function runOnce(tag, rightCount) {
    const run = { tag, cats: [], qs: [], score: null, breakdown: '', reviewCount: 0 };

    window.SlyApp.go('quiz');
    await sleep(800);

    document.querySelector('.pick[data-cat="近况"]').click();
    await sleep(80);
    run.startEnabled = !$('startBtn').disabled;
    run.startText = $('startBtnText').textContent;
    $('startBtn').click();
    await sleep(300);

    for (let i = 0; i < 60; i++) {
      if (!$('quizResult').hidden) break;
      if ($('quizPlay').hidden) { await sleep(120); continue; }
      const input = $('qInput');
      if (input.disabled) { $('qSubmit').click(); await sleep(120); continue; }

      const q = $('qText').textContent;
      run.cats.push($('qCat').textContent);
      run.qs.push(q);
      const done = run.qs.length - 1;
      setVal(input, done < rightCount ? answerOf(q) : '瞎写一个错的' + done);
      $('qSubmit').click();
      await sleep(120);
    }

    run.score = Number($('rScore').textContent);
    run.total = $('rTotal').textContent;
    run.comment = $('rComment').textContent;
    run.breakdown = $('rBreakdown').innerText.replace(/\s+/g, ' ').trim();
    run.reviewCount = $('rReview').querySelectorAll('li').length;
    return run;
  }

  (async function main() {
    try {
      window.SlyQuiz.refresh();
      await sleep(200);
      log.entryStamp = $('bankStamp').textContent;
      log.cntNear = $('cnt近况').textContent;
      log.cntLike = $('cnt爱好').textContent;
      log.cntHabit = $('cnt习惯').textContent;
      log.bankWarn = $('bankWarn').hidden ? '(隐藏)' : $('bankWarn').textContent;

      await passGate();

      const r1 = await runOnce('第一轮：前 7 题答对', 7);
      log.runs.push(r1);

      $('againBtn').click();
      await sleep(400);
      const r2 = await runOnce('第二轮：全对', 10);
      log.runs.push(r2);

      log.sameQuestionOrder = JSON.stringify(r1.qs) === JSON.stringify(r2.qs);
      log.overlap = r1.qs.filter((q) => r2.qs.includes(q)).length;
      log.lockBtn = !!$('lockBtn');

      log.boards = await testBoards();
    } catch (e) {
      log.errors.push(String((e && e.stack) || e));
    }
    finish();
  })();
})();
