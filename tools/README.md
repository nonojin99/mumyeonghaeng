# tools/ — 검증 하네스

- `verify.mjs` — Playwright 헤드리스 전 경로 검증 + 결정론적 60Hz 밸런스 시뮬 (33개 항목).
  실행: `npm i` 후 `npm run verify` (Playwright chromium 필요 — 처음 한 번 `npx playwright install chromium`)
- `sim.js` — 페이지에 주입되는 자동 조작(카이팅 + 상식적 카드 선택). verify.mjs가 읽어서 주입한다.
- 스크린샷은 `tools/shots/`에 떨어진다.

v2 계획(docs/PLAN-v2.md §7)에서 lint-data.mjs(데이터 정합+한자 잔존 린터)와
GitHub Actions CI(.github/workflows/verify.yml)가 여기에 추가될 예정.
