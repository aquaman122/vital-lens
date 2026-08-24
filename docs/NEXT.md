# vital-lens 작업 인수인계 (NEXT)

> 새 Claude Code 세션(휴대폰 클라우드 세션 포함)은 이 파일과 README.md, docs/PRD.md를 먼저 읽고 작업한다.

## 현재 상태 (2026-08-24)
- v0.1 코드 완성, 빌드 통과. 구조: `packages/collector`(gzip 3.3KB, web-vitals+에러 → Supabase RPC) / `apps/dashboard`(Next.js 15 서버 컴포넌트, p75 추이·release 비교·느린 페이지·에러 목록) / `supabase/migrations/0001_init.sql`(RLS 전면 + security definer RPC `vl_ingest`, 집계 뷰 4개).
- **Supabase 연결 완료** (1단계): 프로젝트 `vital-lens` (ref `xnnpfpwtiacsbdftchzg`, org `aquaman122's Org`, region ap-northeast-2, Free).
  - URL `https://xnnpfpwtiacsbdftchzg.supabase.co`, publishable key `sb_publishable_2aK-9WVI8wlmy_sMw3y2rQ_Cx1Ph6pq`.
  - 마이그레이션 `0001_init`, `0002_revoke_vl_prune_from_anon` 적용. `sites`에 `zini-pinlog`(핀로그) 등록.
  - `apps/dashboard/.env.local` 생성(gitignore됨). **`SUPABASE_SECRET_KEY`는 비어 있음** — Supabase Dashboard > Project Settings > API Keys 의 service_role 값을 직접 채워야 대시보드가 뜬다(MCP로는 조회 불가).
- **ingest 검증 완료** (3단계 중 RPC 부분): 쿼리스트링 제거, message 500자·stack 2000자 절단, value 600000 클램프, 미지 device→`unknown`, 미지 type 스킵, 배치 0/51·비배열·없는 사이트 모두 거부, anon의 테이블 직접 읽기 및 `vl_prune` 실행 차단 확인.
  - 검증용 더미 이벤트 4행이 남아 있다. 실데이터 들어오기 전에 정리: `delete from events where release in ('abc1234','unknown');`
- 아직 안 된 것: 대시보드 secret key 입력 후 실행 확인, 실제 사이트(zini-pinlog)에 수집 부착, 대시보드 배포.

### 보안 수정 기록 (2026-08-24)
`0001_init.sql`의 `revoke all on function ... from public` 만으로는 Supabase가 default privilege로 `anon`/`authenticated`에 준 EXECUTE가 남는다. 그 결과 publishable 키만으로 `vl_prune(0)` 을 호출해 `events` 전체를 지울 수 있었다. `revoke execute ... from anon, authenticated` 를 `0001_init.sql`에 추가하고 원격에는 `0002`로 적용. **함수 권한은 `from public` 이 아니라 역할을 명시해 회수할 것.**

## 다음 작업 순서
1. ~~**Supabase 연결**~~ — 완료(위 참조). 남은 것: `.env.local`의 `SUPABASE_SECRET_KEY` 채우기.
2. **수집 부착**: zini-pinlog 리포에 README의 "방법 B" `<Rum />` 컴포넌트 추가. `release`는 `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0,7)`. 사이트 id는 `zini-pinlog`, 키는 위 publishable key.
3. **검증**: secret key 채운 뒤 `pnpm --filter dashboard dev` (http://localhost:3100) 로 위 더미 이벤트가 렌더되는지 확인 → 더미 정리 → zini-pinlog 실이벤트 유입 확인.
4. **배포**: 대시보드를 Vercel에 올리되 반드시 비공개(Password Protection). secret key는 서버 env로만.
5. **v0.2 후보** (PRD 로드맵): INP attribution, 배포 후 p75 임계 초과 웹훅 알림, 일별 롤업 테이블, `vl_prune` pg_cron 스케줄.

## 지켜야 할 원칙
- 보안: 권한은 키가 아니라 함수에. anon에 테이블 정책을 만들지 않는다. secret key를 `NEXT_PUBLIC_`으로 노출하지 않는다.
- 개인정보: IP·UA 원문·쿠키·사용자 식별자 수집 금지. path는 쿼리스트링 제거, 에러 메시지 500자 절단 유지.
- 차트: 단일 축, 시리즈별 고정 색, 텍스트는 텍스트 토큰 색(시리즈 색 금지). 기존 `MetricTrend` 패턴을 따른다.
- collector 크기 예산: gzip 4KB 초과 금지. 의존성 추가 전에 크기를 확인한다(`pnpm --filter @vital-lens/collector size`).
- 철수 기준(PRD): 4주간 대시보드를 주 1회도 안 열면 아카이브. 이 기준을 지우지 말 것.

## 기록
- 의미 있는 결정·시행착오는 커밋 메시지에 남기고, 주 1회 Obsidian `LLM-Wiki`(raw/에 넣고 /ingest)로 옮긴다. 이 프로젝트는 면접 스토리("관측 부재로 겪은 실패를 도구로 해결")의 근거 자료다.
