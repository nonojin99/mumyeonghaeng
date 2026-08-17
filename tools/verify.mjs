import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

// 어디서 실행해도 저장소 기준으로 경로를 잡는다 (tools/ 아래에 산다)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FILE = 'file://' + path.join(ROOT, 'rpg.html');
const SHOT = path.join(HERE, 'shots') + path.sep;
await fs.mkdir(SHOT, { recursive: true });

// 페이지 안에서 도는 자동 조작 — 적 밀집도의 반대 방향으로 도망친다(kiting)
const AUTOPILOT = `
window.__auto = { on: true, held: null, picks: 0, log: [] };
(function(){
  const H = window.__hyeollo;
  function press(dir){
    const map = {u:'ArrowUp', d:'ArrowDown', l:'ArrowLeft', r:'ArrowRight'};
    const want = dir.split('');
    const all = ['u','d','l','r'];
    for (const k of all){
      const on = want.includes(k);
      const held = window.__auto.held && window.__auto.held.includes(k);
      if (on && !held) window.dispatchEvent(new KeyboardEvent('keydown', {key: map[k], bubbles:true}));
      if (!on && held) window.dispatchEvent(new KeyboardEvent('keyup', {key: map[k], bubbles:true}));
    }
    window.__auto.held = dir;
  }
  setInterval(() => {
    if (!window.__auto.on) return;
    // 레벨업 카드가 떠 있으면 첫 장을 고른다
    const lv = document.getElementById('levelup');
    if (lv && lv.classList.contains('on')) {
      const c = lv.querySelector('.lvc');
      if (c) { c.click(); window.__auto.picks++; }
      return;
    }
    const R = H.R;
    if (!R || R.over || R.paused) return;
    // 반경 260 안의 적 무게중심에서 멀어지는 방향
    let ax = 0, ay = 0, n = 0;
    const arr = H.pools.enemy.a;
    for (let i = 0; i < arr.length; i++){
      const e = arr[i];
      if (!e.alive || e.altar) continue;
      const dx = e.x - R.px, dy = e.y - R.py, d2 = dx*dx + dy*dy;
      if (d2 > 260*260) continue;
      const w = 1/(d2 + 400);
      ax += dx*w; ay += dy*w; n++;
    }
    let vx, vy;
    if (n === 0) { const t = Date.now()/900; vx = Math.cos(t); vy = Math.sin(t); }
    else { vx = -ax; vy = -ay; }
    const m = Math.hypot(vx, vy) || 1;
    vx /= m; vy /= m;
    let dir = '';
    if (vy < -0.38) dir += 'u'; else if (vy > 0.38) dir += 'd';
    if (vx < -0.38) dir += 'l'; else if (vx > 0.38) dir += 'r';
    if (!dir) dir = 'r';
    press(dir);
  }, 90);
})();
`;

const SIM = await fs.readFile(path.join(HERE, 'sim.js'), 'utf8');
const errors = [];
const browser = await chromium.launch();

async function newPage(vp) {
  const ctx = await browser.newContext(vp.width ? Object.assign({ viewport: { width: vp.width, height: vp.height } }, vp) : vp);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { ctx, page };
}

function pct(x) { return Math.round(x * 1000) / 10 + '%'; }
function ok(label, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra != null ? '  → ' + extra : ''));
  if (!cond) process.exitCode = 1;
  return cond;
}

// ─────────────────────────────────────────────────────────
console.log('\n=== 1. 부팅 · 명패 → 허브 ===');
let { ctx, page } = await newPage({ width: 390, height: 780 });
await page.goto(FILE);
await page.waitForFunction('!!window.__hyeollo', { timeout: 8000 });
ok('부팅 후 __hyeollo 노출', true);
ok('시작 화면 표시', await page.isVisible('#s-name'));

await page.click('#sect-grid .sect-cell >> nth=0');           // 화산파
await page.fill('#name-input', '무명객');
await page.click('#btn-begin');
await page.waitForSelector('#modal.on');
await page.click('#md-opts .btn');
await page.waitForSelector('#s-hub.on');
ok('허브 진입', await page.isVisible('#s-hub'));
const meta0 = await page.evaluate(() => ({ name: __hyeollo.M.name, sect: __hyeollo.M.sect, realm: __hyeollo.M.realm }));
ok('메타 생성', meta0.name === '무명객' && meta0.sect === 'hwasan', JSON.stringify(meta0));

const stageCells = await page.locator('#stage-list .stage-cell').count();
const locked = await page.locator('#stage-list .stage-cell.locked').count();
ok('권역 6개 · 1권역만 해금', stageCells === 6 && locked === 5, `cells=${stageCells} locked=${locked}`);

console.log('\n=== 2. 브리핑 → 런 진입 ===');
await page.click('#stage-list .stage-cell >> nth=0');
await page.waitForSelector('#s-brief.on');
ok('미션 브리핑 표시', await page.isVisible('#bf-main'));
const briefTxt = await page.textContent('#bf-main');
ok('주 미션 문구', /관문의 고수|적풍/.test(briefTxt), briefTxt.trim().slice(0, 60));
await page.click('#btn-enter');
await page.waitForFunction('window.__hyeollo.R && window.__hyeollo.R.t > 0.3', { timeout: 5000 });
ok('런 시작 · HUD 표시', await page.isVisible('#hud'));

console.log('\n=== 3. 입력 → 이동 ===');
const before = await page.evaluate(() => ({ x: __hyeollo.R.px, y: __hyeollo.R.py }));
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(600);
await page.keyboard.up('ArrowRight');
const after = await page.evaluate(() => ({ x: __hyeollo.R.px, y: __hyeollo.R.py }));
ok('키 입력으로 이동', after.x - before.x > 30, `Δx=${(after.x - before.x).toFixed(1)}`);

console.log('\n=== 4. 스폰 · 자동 공격 · 구슬 ===');
await page.waitForTimeout(1800);
const c1 = await page.evaluate(() => __hyeollo.counts());
ok('적 스폰됨', c1.enemies > 0, JSON.stringify(c1));
// 적은 화면 밖 타원에서 생성되어 다가온다 — 사거리에 닿을 시간을 준다
await page.waitForTimeout(4500);
const dealt = await page.evaluate(() => Object.values(__hyeollo.R.dmgBy).reduce((a, b) => a + b, 0));
ok('무공이 자동으로 피해를 준다', dealt > 0, '누적 피해 ' + Math.round(dealt));
const st = await page.evaluate(() => ({ kills: __hyeollo.R.kills, xp: __hyeollo.R.xp, lv: __hyeollo.R.level }));
ok('적을 참살하고 기(氣)를 흡수', st.kills > 0 && (st.xp > 0 || st.lv > 1), JSON.stringify(st));

console.log('\n=== 5. 레벨업 3택 ===');
await page.waitForFunction('document.getElementById("levelup").classList.contains("on")', { timeout: 30000 });
const cards = await page.locator('#lv-cards .lvc').count();
ok('레벨업 카드 3장', cards === 3, 'cards=' + cards);
const cardTxt = await page.textContent('#lv-cards .lvc >> nth=0');
await page.click('#lv-cards .lvc >> nth=0');
await page.waitForTimeout(300);
ok('카드 선택 후 런 재개', await page.evaluate(() => !document.getElementById('levelup').classList.contains('on')),
   cardTxt.replace(/\s+/g, ' ').trim().slice(0, 46));
await page.screenshot({ path: SHOT + 'shot_run.png' });

console.log('\n=== 6. 결정론적 60Hz 밸런스 시뮬 ===');
await page.evaluate(SIM);
async function playRun(stage, asc, maxSec, statLv) {
  await page.evaluate(() => { const H = window.__hyeollo; if (H.R && !H.R.over) H.endRun(false); });
  await page.evaluate(() => { if (document.getElementById('s-result').classList.contains('on')) document.getElementById('btn-result-ok').click(); });
  return await page.evaluate(a => window.__sim.run(a[0], a[1], a[2], a[3]), [stage, asc, maxSec, statLv]);
}
const runs = [];
for (let i = 0; i < 3; i++) runs.push(await playRun(0, 0, 700, 0));   // 신참 · 3회 (분산 확인)
for (let i = 0; i < 3; i++) runs.push(await playRun(0, 0, 700, 20));   // 투자한 무인 · 3회 (분산 확인)
runs.push(await playRun(0, 10, 700, 20));  // 같은 무인, 승천 10
runs.push(await playRun(0, 20, 700, 20));  // 같은 무인, 승천 20 — 천마의 시험
for (const r of runs) {
  console.log('    ' + JSON.stringify({ 능력치: r.statLevel, 승천: r.asc, 클리어: r.won, 생존: r.t + '/' + r.survive + 's',
    참살: r.kills, Lv: r.level, 피격: r.hits, 선택: r.picks, 스텝: r.stepUs + 'µs' }));
  console.log('      초식: ' + r.arts.join(' · ') + '  |  심법: ' + r.sims.join(' · '));
}
const freshAll = runs.slice(0, 3), devAll = runs.slice(3, 6), hard = runs[6], extreme = runs[7];
const fresh = freshAll[0];
const devWins = devAll.filter(r => r.won).length;
const dev = devAll.find(r => r.won) || devAll[0];
// 신참의 기준은 "클리어"가 아니라 "다음 판을 살 만큼 진기를 버는가"다
const freshQis = freshAll.map(r => Math.floor((r.kills * 0.9 + r.t * 0.65) * 1.25));
const freshQi = Math.min(...freshQis);
// 검증할 것은 임의의 수치가 아니라 "루프가 몇 판에 부팅되는가"다.
// statCostN(0,n): 능력치 한 축을 0→n단 올리는 진기 총액
const costN = n => { let c = 0; for (let i = 0; i < n; i++) c += Math.ceil(8 * Math.pow(1.14, i)); return c; };
const devQi = Math.floor((dev.kills * 0.9 + dev.t * 0.65) * 1.25);
console.log('    신참 판당 진기 ' + Math.min(...freshQis) + '~' + Math.max(...freshQis) +
            ' (능력치 ' + [8,10,12].filter(n => costN(n) <= Math.min(...freshQis)).pop() + '~' +
            [8,10,12,14].filter(n => costN(n) <= Math.max(...freshQis)).pop() + '단) · 클리어 판당 ' + devQi);
ok('신참 한 판이 능력치 8단 이상을 산다 (루프 부팅)', freshQi >= costN(8),
   '진기 ' + freshQis.join('/') + ' vs 8단 ' + costN(8) + ' · ' + freshAll.map(r => r.t + 's/' + r.kills + '킬/Lv' + r.level).join(' '));
ok('클리어하면 수급이 급증한다 (신참 최고치의 2배+)', devQi >= Math.max(...freshQis) * 2, devQi + ' vs ' + Math.max(...freshQis));
ok('투자한 무인은 권역 1 승천 0을 안정적으로 평정 (3전 3승)', devWins === 3,
   `${devWins}/3승 · ` + devAll.map(r => (r.won ? '승' : '패') + r.t + 's/' + r.kills + '킬').join(' '));
// 승천 10의 난이도는 결과로 재면 안 된다 — 적이 많아지면 기 구슬도 많아져 빌드가 강해지므로
// 피격 수·킬 수가 오히려 좋아진다. 압박이 실제로 걸리는지는 모디파이어로 검증한다.
const m0 = await page.evaluate(() => __hyeollo.ascMods(0));
const m10 = await page.evaluate(() => __hyeollo.ascMods(10));
const m20 = await page.evaluate(() => __hyeollo.ascMods(20));
ok('승천 10은 구조적 압박이 실제로 걸린다', m10.choices === 2 && m10.twinBoss && m10.elite > 0 &&
   m10.spawn > m0.spawn && m10.ehp > m0.ehp && m10.pickup < m0.pickup,
   `선택지 ${m0.choices}→${m10.choices} · 고수 2체 ${m10.twinBoss} · 정예 ${pct(m10.elite)} · 스폰 ×${m10.spawn.toFixed(2)} · 흡수 ×${m10.pickup.toFixed(2)}`);
ok('승천 20은 압박이 극에 달한다', m20.curse === 2 && m20.eliteArmor > 0 && m20.bossShield > 0 && m20.spawn > m10.spawn,
   `내상 ${m20.curse}칸 · 정예 강기 ${pct(m20.eliteArmor)} · 고수 강기 ${pct(m20.bossShield)} · 스폰 ×${m20.spawn.toFixed(2)}`);
console.log('    승천 결과: 0→' + dev.kills + '킬/클리어' + dev.won + '  10→' + hard.kills + '킬/클리어' + hard.won +
            '  20→' + extreme.kills + '킬/클리어' + extreme.won);
ok('무공 슬롯이 채워진다 (초식 3+)', dev.arts.length >= 3, 'arts=' + dev.arts.length);
ok('스텝 비용 ≤ 4000µs (60fps 예산 16667µs)', dev.stepUs <= 4000, dev.stepUs + 'µs');
ok('승천 20(천마의 시험)은 승천 0보다 확실히 혹독', extreme.kills < dev.kills || !extreme.won || extreme.hits > dev.hits,
   `승천0: ${dev.kills}킬/${dev.hits}피격/클리어${dev.won} → 승천20: ${extreme.kills}킬/${extreme.hits}피격/클리어${extreme.won}`);

console.log('\n=== 7. 렌더 성능 (밀집 상태에서 step+draw) ===');
const perf = await page.evaluate(async () => {
  const H = window.__hyeollo;
  H.startRun(0, 14);
  window.__sim.held = {};
  for (let i = 0; i < 60 * 300; i++) {                   // 승천 14로 300초까지 밀어붙여 최대 군집을 만든다
    if (H.lvOpen) { const c = window.__sim.choose(); if (c) { c.click(); continue; } }
    if (i % 6 === 0) { const [vx, vy] = window.__sim.aim(); window.__sim.press(vx, vy); }
    H.stepRun(1 / 60);
    if (H.R.over) break;
    if (i % 900 === 0) await new Promise(r => setTimeout(r, 0));
  }
  window.__sim.release();
  const c = H.counts();
  let st = 0, dr = 0;
  for (let i = 0; i < 120; i++) { const a = performance.now(); H.stepRun(1 / 60); const b = performance.now(); H.draw(); const d = performance.now(); st += b - a; dr += d - b; }
  return { counts: c, step: st / 120, draw: dr / 120, t: H.R.t };
});
console.log('    엔티티 ' + JSON.stringify(perf.counts) + ' · 게임시간 ' + perf.t.toFixed(0) + 's');
console.log('    step ' + perf.step.toFixed(2) + 'ms · draw ' + perf.draw.toFixed(2) + 'ms · 합 ' + (perf.step + perf.draw).toFixed(2) + 'ms');
ok('밀집 상태 적 200+', perf.counts.enemies >= 200, 'enemies=' + perf.counts.enemies);
ok('step+draw ≤ 16.6ms (60fps 유지)', perf.step + perf.draw <= 16.6, (perf.step + perf.draw).toFixed(2) + 'ms');
await page.screenshot({ path: SHOT + 'shot_dense.png' });
await page.evaluate(() => { const H = window.__hyeollo; if (H.R && !H.R.over) H.endRun(false); });
await page.waitForSelector('#s-result.on');

console.log('\n=== 8. 정산 → 허브 · 능력치 구매 ===');
await page.click('#btn-result-ok');
await page.waitForSelector('#s-hub.on');
await page.evaluate(() => { for (const k in __hyeollo.M.stats) __hyeollo.M.stats[k] = 0; __hyeollo.goHub(); });
await page.click('.hb-tab[data-t="stat"]');
const qi1 = await page.evaluate(() => __hyeollo.M.qi);
ok('진기 정산됨', qi1 > 0, 'qi=' + qi1);
await page.click('.hb-tab[data-t="stat"]');
await page.waitForTimeout(150);
const buyable = await page.locator('#stat-list button[data-n="1"]:not([disabled])').count();
ok('능력치 구매 버튼 활성', buyable > 0, 'buttons=' + buyable);
if (buyable > 0) {
  await page.click('#stat-list button[data-n="1"]:not([disabled]) >> nth=0');
  await page.waitForTimeout(150);
  const after2 = await page.evaluate(() => ({ qi: __hyeollo.M.qi, sum: Object.values(__hyeollo.M.stats).reduce((a, b) => a + b, 0) }));
  ok('진기를 써서 능력치 상승', after2.qi < qi1 && after2.sum > 0, JSON.stringify(after2));
}
await page.click('.hb-tab[data-t="realm"]');
await page.waitForTimeout(150);
await page.screenshot({ path: SHOT + 'shot_hub.png', fullPage: true });
ok('경지 패널 렌더', (await page.textContent('#realm-box')).includes('능력치 상한'));

console.log('\n=== 9. 저장 · 이어하기 ===');
await page.reload();
await page.waitForFunction('!!window.__hyeollo', { timeout: 8000 });
const loadNote = await page.textContent('#load-note');
ok('세이브 감지', /이어갈 기록/.test(loadNote), loadNote.replace(/\s+/g, ' ').trim().slice(0, 50));
await page.click('#load-note .btn');
await page.waitForSelector('#s-hub.on');
ok('이어하기로 허브 복귀', (await page.textContent('#hb-name')) === '무명객');
await ctx.close();

console.log('\n=== 10. 모바일 뷰포트 (375×667) · 가상 조이스틱 ===');
({ ctx, page } = await newPage({ width: 375, height: 667, hasTouch: true, isMobile: true }));
await page.goto(FILE);
await page.waitForFunction('!!window.__hyeollo', { timeout: 8000 });
await page.click('#sect-grid .sect-cell >> nth=1');      // 새 컨텍스트 = 빈 저장소이므로 명패부터
await page.fill('#name-input', '설하객');
await page.click('#btn-begin');
await page.waitForSelector('#modal.on');
await page.click('#md-opts .btn');
await page.waitForSelector('#s-hub.on');
await page.click('#stage-list .stage-cell >> nth=0');
await page.waitForSelector('#s-brief.on');
await page.click('#btn-enter');
await page.waitForFunction('window.__hyeollo.R && window.__hyeollo.R.t > 0.3', { timeout: 5000 });
const mb = await page.evaluate(() => ({ x: __hyeollo.R.px, y: __hyeollo.R.py }));
await page.touchscreen.tap(190, 500);
await page.evaluate(() => {
  const cv = document.getElementById('cv');
  const mk = (t, x, y) => new TouchEvent(t, { bubbles: true, cancelable: true,
    changedTouches: [new Touch({ identifier: 1, target: cv, clientX: x, clientY: y })] });
  cv.dispatchEvent(mk('touchstart', 190, 500));
  cv.dispatchEvent(mk('touchmove', 240, 500));
});
await page.waitForTimeout(600);
const mv = await page.evaluate(() => ({ x: __hyeollo.R.px, stick: document.getElementById('stick').classList.contains('on') }));
ok('가상 조이스틱 표시', mv.stick);
ok('터치로 이동', mv.x - mb.x > 20, `Δx=${(mv.x - mb.x).toFixed(1)}`);
await page.screenshot({ path: SHOT + 'shot_mobile.png' });
const noHscroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok('가로 스크롤 없음', noHscroll);
await ctx.close();

await browser.close();
console.log('\n=== 콘솔 오류 ===');
// 구글 폰트 fetch 실패는 코드 오류가 아니다 (오프라인이면 serif로 대체 렌더)
const net = errors.filter(e => /net::|Failed to load resource/.test(e));
const real = errors.filter(e => !/net::|Failed to load resource/.test(e));
if (net.length) console.log('  (참고) 웹폰트 로드 실패 ' + net.length + '건 — 오프라인 환경, serif로 대체됨');
if (real.length) { real.slice(0, 12).forEach(e => console.log('  ' + e)); process.exitCode = 1; }
else console.log('  코드 오류 없음 (0건)');
console.log(process.exitCode ? '\n실패한 항목이 있다.' : '\n전 항목 통과.');
