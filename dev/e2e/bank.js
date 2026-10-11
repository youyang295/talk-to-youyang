/* e2e 专用题库：三个分类各 12 题，答案可辨认，用来验证抽题规则和判分 */
(function () {
  function mk(cat, n) {
    const arr = [];
    for (let i = 1; i <= n; i++) {
      arr.push({ q: `${cat}第${i}题`, a: `${cat}-答案${i}`, alts: [`${cat}答案${i}`] });
    }
    return arr;
  }
  window.SLY_BANK = {
    generatedAt: 'e2e',
    placeholders: 0,
    total: 36,
    cats: { 近况: mk('近况', 12), 爱好: mk('爱好', 12), 习惯: mk('习惯', 12) },
  };
})();
