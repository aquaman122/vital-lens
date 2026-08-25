# vital-lens 작업 인수인계 (NEXT)

> 새 Claude Code 세션(휴대폰 클라우드 세션 포함)은 이 파일과 README.md, docs/PRD.md를 먼저 읽고 작업한다.

## 현재 상태 (2026-08-25)
- v0.1 코드 완성, 빌드 통과. 구조: `packages/collector`(gzip 3.3KB, web-vitals+에러 → Supabase RPC) / `apps/dashboard`(Next.js 15 서버 컴포넌트, p75 추이·release 비교·느린 페이지·에러 목록) / `supabase/migrations/0001_init.sql`(RLS 전면 + security definer RPC `vl_ingest`, 집계 뷰 4개).
- **1단계 Supabase 연결 완료**: 프로젝트 `vital-lens` (ref `xnnpfpwtiacsbdftchzg`, org `aquaman122's Org`, region ap-northeast-2, Free).
  - URL `https://xnnpfpwtiacsbdftchzg.supabase.co`, publishable key `sb_publishable_2aK-9WVI8wlmy_sMw3y2rQ_Cx1Ph6pq`.
  - 마이그레이션 `0001_init`, `0002_revoke_vl_prune_from_anon` 적용. `sites`에 `zini-pinlog`(핀로그) 등록.
  - `.mcp.json`으로 Supabase MCP를 이 project_ref에 고정(다음 세션에서 승인·인증 필요). `.agents/skills/`에 supabase agent skills 설치.
  - `apps/dashboard/.env.local` 채움(gitignore됨). service_role 키는 MCP로 조회할 수 없어 사람이 직접 넣어야 한다. 넣은 뒤 확인하는 법(키 값은 안 보고 claim만):
    ```
    awk -F= '/^SUPABASE_SECRET_KEY=/{print $2}' apps/dashboard/.env.local \
      | python3 -c "import sys,json,base64;t=sys.stdin.read().strip();p=t.split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p)))"
    ```
    `ref`가 `xnnpfpwtiacsbdftchzg`이고 `role`이 `service_role`이어야 한다. anon 키나 다른 프로젝트 키를 넣기 쉽다.
- **2단계 수집 부착 완료**: zini-pinlog `dev` 브랜치 커밋 `85f195b`.
  - `public/vital-lens.min.js`(빌드 산출물 사본) + `src/app/Rum.tsx`(`next/script`, data-* 자동 초기화) + `layout.tsx` 마운트 + `env.ts`에 `NEXT_PUBLIC_VITAL_LENS_URL/_KEY`.
  - **npm 패키지가 아니라 정적 파일로 붙였다.** `@vital-lens/collector`는 레지스트리에 없고 `file:` 의존성은 리포 밖 경로라 Vercel에서 안 풀린다. README "방법 B"(모듈 import)는 패키지를 publish하기 전까지 불가 — 지금은 "방법 A"에 해당. 갱신은 `pnpm --filter @vital-lens/collector build` 후 `cp packages/collector/dist/vital-lens.min.js ../zini-pinlog/public/`.
  - env 이름을 `NEXT_PUBLIC_VITAL_LENS_*`로 분리한 이유: zini-pinlog가 이미 자기 Supabase를 `NEXT_PUBLIC_SUPABASE_*`로 쓰고 있다.
  - `release`는 `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0,7)`, 로컬은 `"dev"`로 폴백해 실배포 데이터와 섞이지 않게 했다.
- **첫 대상은 kt-market**: zini-pinlog의 Supabase 프로젝트가 없어져서 첫 관측 대상을 `juntelecom/apps/kt-market`으로 잡았다. zini-pinlog 부착도 되돌리지 않고 그대로 둬서 두 사이트를 함께 수집한다. `sites`에 `zini-pinlog`, `kt-market` 두 개.
- **kt-market 부착 완료**: juntelecom `feat/phone-detail-page` 커밋 `c0597f8`.
  - `apps/kt-market/public/vital-lens.min.js` + `src/features/analytics/components/Rum.tsx` + `layout.tsx`에서 `<Analytics />` 옆에 마운트 + `src/shared/lib/analytics.ts`에 `VITAL_LENS_URL/KEY`.
  - kt-market에는 zini-pinlog 같은 `env.ts`(zod) 모듈이 없어서, 기존 트래커 상수들이 모여 있는 `shared/lib/analytics.ts` 패턴을 따랐다.
  - 여기도 env 이름은 `NEXT_PUBLIC_VITAL_LENS_*` — `NEXT_PUBLIC_SUPABASE_*`는 이미 kt-market 자체 프로젝트가 쓴다.
- **3단계 검증**: ingest RPC 전항목 통과 — 쿼리스트링 제거, message 500자·stack 2000자 절단, value 600000 클램프, 미지 device→`unknown`, 미지 type 스킵, 배치 0/51·비배열·없는 사이트 거부, anon의 테이블 직접 읽기 및 `vl_prune` 실행 차단.
  - 로컬 dev 서버 실전 확인: 페이지 로드 2회 → `pageview`+`TTFB` 4행 적재(path·device·conn 정상). 검증용 더미 행은 삭제 완료.
  - kt-market도 동일하게 확인: 페이지 로드 2회 → `pageview`+`TTFB` 적재(path·device·conn 정상).
  - **LCP/FCP/CLS는 자동화 브라우저에서 보고되지 않는다 — 버그 아님.** 브라우저 창에서 확인한 결과 `document.visibilityState === 'hidden'` 이었고, `paint` 엔트리(FCP 5624ms)는 존재했다. web-vitals는 페인트 전에 숨겨진 페이지의 LCP/FCP/CLS를 의도적으로 보고하지 않는다. 실브라우저에서 재확인 필요.
- **대시보드 동작 확인 완료**: `pnpm install` 후 http://localhost:3100 에서 사이트 목록·kt-market 상세 모두 200. release 표에 `dev` 3샘플 표시.
  - 이 과정에서 v0.1 버그 하나를 고쳤다: `page.tsx`가 `format` **함수**를 클라이언트 컴포넌트 `MetricTrend`로 넘기고 있었다. 서버→클라이언트 props는 직렬화돼야 해서 함수는 못 넘어간다. 타입체크·빌드는 통과하고 렌더에서만 500이 나던 것. `decimals: number`를 넘기고 포맷은 클라이언트에서 한다. **서버 컴포넌트에서 클라이언트 컴포넌트로 함수를 넘기지 말 것.**
- **LCP/FCP 실수집 확인 완료 — 3단계 종료.** 사람이 탭을 앞으로 둔 채 kt-market을 열자 LCP 692ms(1건), FCP 460·984ms(2건)가 들어왔고, 대시보드가 LCP 카드에 "좋음 692ms · p75", release 표에 `dev / LCP p75 692 / 샘플 14`, 느린 페이지에 `/ 692ms` 를 렌더했다. collector → `vl_ingest` → 집계 뷰 → 대시보드 전 구간 관통.
  - CLS·INP는 안 왔는데 정상이다. web-vitals는 layout shift가 0건이면 CLS를 보고하지 않고, 상호작용이 0건이면 INP를 보고하지 않는다.
  - **LCP/CLS/INP는 자동화로 확인할 수 없다.** 인앱 Browser 패널, Chrome 자동화 탭 그룹, CDP 강제 페인트 세 경로 모두 `visibilityState: hidden`이었고 LCP 엔트리가 0개였다. 브라우저는 화면에 실제로 보이는 페이지에만 LCP를 만든다. 앞으로도 이 확인은 사람이 해야 한다 — 합성 모니터링으로 CWV가 안 나오는 것이 이 도구(RUM)의 존재 이유이기도 하다.
- 대시보드 프로덕션 빌드 통과(`next build`). 두 라우트 모두 동적(`ƒ`)이라 secret key가 정적 산출물로 새지 않는다.
- 아직 안 된 것: 대시보드 배포(Vercel MCP 미인증), kt-market 실배포 수집.

### 보안 수정 기록 (2026-08-24)
`0001_init.sql`의 `revoke all on function ... from public` 만으로는 Supabase가 default privilege로 `anon`/`authenticated`에 준 EXECUTE가 남는다. 그 결과 publishable 키만으로 `vl_prune(0)` 을 호출해 `events` 전체를 지울 수 있었다. `revoke execute ... from anon, authenticated` 를 `0001_init.sql`에 추가하고 원격에는 `0002`로 적용. **함수 권한은 `from public` 이 아니라 역할을 명시해 회수할 것.**

## 다음 작업 순서
1. ~~**Supabase 연결**~~ 완료(secret key 포함).
2. ~~**수집 부착**~~ 완료(zini-pinlog `85f195b`).
3. ~~**검증**~~ 완료(LCP/FCP까지 확인, 위 참조).
4. **배포**: 대시보드를 Vercel에 올리되 반드시 비공개(Password Protection). secret key는 서버 env로만. kt-market(과 zini-pinlog) Vercel 프로젝트에 `NEXT_PUBLIC_VITAL_LENS_URL/_KEY` 두 개 등록. (Vercel MCP는 미인증 상태 — 인터랙티브 세션에서 `/mcp` 필요.)
5. **v0.2 후보** (PRD 로드맵): INP attribution, 배포 후 p75 임계 초과 웹훅 알림, 일별 롤업 테이블, `vl_prune` pg_cron 스케줄, `@vital-lens/collector` npm publish(그러면 README 방법 B가 실제로 가능).

## 지켜야 할 원칙
- 보안: 권한은 키가 아니라 함수에. anon에 테이블 정책을 만들지 않는다. secret key를 `NEXT_PUBLIC_`으로 노출하지 않는다.
- 개인정보: IP·UA 원문·쿠키·사용자 식별자 수집 금지. path는 쿼리스트링 제거, 에러 메시지 500자 절단 유지.
- 차트: 단일 축, 시리즈별 고정 색, 텍스트는 텍스트 토큰 색(시리즈 색 금지). 기존 `MetricTrend` 패턴을 따른다.
- collector 크기 예산: gzip 4KB 초과 금지. 의존성 추가 전에 크기를 확인한다(`pnpm --filter @vital-lens/collector size`).
- 철수 기준(PRD): 4주간 대시보드를 주 1회도 안 열면 아카이브. 이 기준을 지우지 말 것.

## 기록
- 의미 있는 결정·시행착오는 커밋 메시지에 남기고, 주 1회 Obsidian `LLM-Wiki`(raw/에 넣고 /ingest)로 옮긴다. 이 프로젝트는 면접 스토리("관측 부재로 겪은 실패를 도구로 해결")의 근거 자료다.
