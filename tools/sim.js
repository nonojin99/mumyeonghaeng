// 페이지 안에 심는 결정론적 60Hz 시뮬레이터.
// __TS 배속은 dt를 키워 충돌이 터널링되므로, 밸런스 측정에는 고정 스텝을 쓴다.
window.__sim = {
  // 적 밀집도의 반대로 도망치는 자동 조작 (kiting)
  aim() {
    const H = window.__hyeollo, R = H.R;
    let ax = 0, ay = 0, n = 0;
    const arr = H.pools.enemy.a;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e.alive || e.altar) continue;
      const dx = e.x - R.px, dy = e.y - R.py, d2 = dx * dx + dy * dy;
      if (d2 > 300 * 300) continue;
      const w = 1 / (d2 + 500);
      ax += dx * w; ay += dy * w; n++;
    }
    let vx, vy;
    if (n === 0) { const t = R.t * 0.7; vx = Math.cos(t); vy = Math.sin(t); }
    else { const m = Math.hypot(ax, ay) || 1; vx = -ax / m; vy = -ay / m; }
    // 관문의 고수가 나타나면 실제 플레이어처럼 붙어서 잡는다 (도망 벡터와 혼합)
    const B = R.boss;
    if (B && B.alive) {
      const dx = B.x - R.px, dy = B.y - R.py, d = Math.hypot(dx, dy) || 1;
      const want = d > 110 ? 1.6 : -0.5;          // 멀면 접근, 너무 붙으면 살짝 뗀다
      vx += dx / d * want; vy += dy / d * want;
      const m2 = Math.hypot(vx, vy) || 1; vx /= m2; vy /= m2;
    }
    return [vx, vy];
  },
  held: {},
  press(vx, vy) {
    const want = {
      ArrowUp: vy < -0.38, ArrowDown: vy > 0.38,
      ArrowLeft: vx < -0.38, ArrowRight: vx > 0.38,
    };
    for (const k in want) {
      if (want[k] && !this.held[k]) window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
      else if (!want[k] && this.held[k]) window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
      this.held[k] = want[k];
    }
  },
  release() { for (const k in this.held) if (this.held[k]) { window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); this.held[k] = false; } },

  // 상식적인 플레이어의 카드 선택. 항상 1번을 고르는 봇은 빌드 운이 곧 측정 잡음이 된다.
  // 우선순위: 진화 > 새 무공(슬롯 채우기) > 무공 강화 > 능력치 > 회복
  choose() {
    const cards = [...document.querySelectorAll('#levelup .lvc')];
    if (!cards.length) return null;
    const score = c => {
      const tag = (c.querySelector('.lc-t') || {}).textContent || '';
      if (c.classList.contains('evo')) return 100;
      if (c.classList.contains('new')) return 80;
      if (tag === '能力') return 30;
      if (tag === '回復') return 10;
      return 60;                                  // 기존 무공 강화
    };
    return cards.reduce((a, b) => (score(b) > score(a) ? b : a));
  },

  // 한 판을 끝까지 돌린다. 반환값은 결과 통계.
  async run(stageIdx, asc, maxSeconds, statLevel) {
    const H = window.__hyeollo;
    if (statLevel != null) for (const k in H.M.stats) H.M.stats[k] = statLevel;
    H.startRun(stageIdx, asc);
    const R0 = H.R;
    const dt = 1 / 60;
    let steps = 0, picks = 0, stepMs = 0;
    this.held = {};
    while (H.R === R0 && !H.R.over && H.R.t < maxSeconds) {
      if (H.lvOpen) {
        const c = this.choose();
        if (c) { c.click(); picks++; continue; }
      }
      if (steps % 6 === 0) { const [vx, vy] = this.aim(); this.press(vx, vy); }
      const t0 = performance.now();
      H.stepRun(dt);
      stepMs += performance.now() - t0;
      steps++;
      if (steps % 900 === 0) await new Promise(r => setTimeout(r, 0));   // 페이지 양보
    }
    this.release();
    const R = H.R;
    const out = {
      stage: R.st.h, asc, statLevel: statLevel == null ? '현상태' : statLevel,
      won: !!R.won, t: +R.t.toFixed(1), survive: R.st.survive,
      kills: R.kills, level: R.level, hits: R.hitCount, evolved: R.evolved,
      picks, arts: R.cho.map(s => H.ARTS[s.id].h + (H.ARTS[s.id].evolved ? '(絕世)' : s.lv)),
      sims: R.sim.map(s => H.ARTS[s.id].h + s.lv),
      alive: H.counts().enemies, stepUs: +(stepMs / Math.max(1, steps) * 1000).toFixed(0),
    };
    if (!R.over) H.endRun(false);
    return out;
  },
};
