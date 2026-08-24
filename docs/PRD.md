# vital-lens PRD

경량 RUM(Real User Monitoring) — 스크립트 한 줄로 Core Web Vitals와 JS 에러를 수집하고, 배포(release)별 회귀를 대시보드로 보는 도구.

## 왜 만드는가
juntelecom 8개월 회고의 결론: "관측 없이 만들면 세 번 폐기한다"(senior-platform), "틀린 값이 고객에게 닿기 전에 아는 시간"이 품질이다(sm-a175nk). 그런데 CWV·에러의 실측값이 없다. Clarity는 세션 리플레이·히트맵을 주지만 **배포 단위 회귀 비교**와 **원시 데이터 소유**를 주지 않는다. 그 틈을 스스로 만든 도구로 메운다.

## MVP 범위 (v0.1)
- collector: `<script>` 한 줄. LCP / INP / CLS / TTFB / FCP + JS 에러(window.onerror, unhandledrejection) + pageview. 샘플링, 배치 전송(fetch keepalive → sendBeacon 폴백), gzip 불필요할 만큼 작게 (< 3KB gzip 목표).
- ingest: Supabase `security definer` RPC 하나. anon 키로 호출하되 **키가 아니라 함수가 권한**을 가진다 — 검증(사이트 존재, 배열 크기, 문자열 길이, 값 범위) 후 insert-only.
- dashboard: Next.js App Router, 서버 컴포넌트 전용. 일별 p75 추이(메트릭별 소형 차트), release별 비교 표, 느린 페이지 top, 최근 에러 목록. 읽기는 secret key로 서버에서만.

## 명시적으로 안 하는 것 (v0.1)
세션 리플레이, 소스맵 심볼리케이션, 알림(웹훅), 사용자별 추적(개인정보 수집 없음 — IP·UA 원문 저장 안 함, 기기 분류만), 대시보드 로그인(로컬/사설 배포 전제).

## 성공 기준
- 내 프로젝트(예: zini-pinlog)에 붙여 14일 데이터가 쌓인다.
- 배포 하나에서 LCP p75 변화가 release 비교 표에서 눈으로 확인된다.
- collector가 Lighthouse 점수를 유의미하게 깎지 않는다(TBT 영향 < 10ms).

## 철수 기준 (compare-hub에서 배운 것)
- 4주 운영 후 내가 대시보드를 주 1회도 안 열면 → 아카이브하고 회고를 위키에 남긴다.
- Vercel/브라우저 API 변화로 수집 정확도가 신뢰 불가가 되고 2주 내 복구 불가면 → 중단.

## 데이터 모델
`sites`(등록된 사이트) / `events`(원시 이벤트: metric | error | pageview). 집계는 뷰(`vl_daily_metrics`, `vl_release_metrics`, `vl_page_metrics`, `vl_recent_errors`)로. 상세는 `supabase/migrations/0001_init.sql`.

## 보안 원칙
- RLS 전면 활성화, anon에 테이블 정책 없음. 쓰기는 `vl_ingest` RPC(security definer)만, 읽기는 대시보드 서버의 secret key만.
- 수집값에 PII 없음: URL은 path만(쿼리스트링 제거), 에러 메시지는 500자 절단.
