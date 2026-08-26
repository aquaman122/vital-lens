# vital-lens 작업 인수인계 (NEXT)

> 새 Claude Code 세션(휴대폰 클라우드 세션 포함)은 이 파일과 README.md, docs/PRD.md를 먼저 읽고 작업한다.

## 현재 상태 (2026-08-26)
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
- **대시보드 Basic 인증 추가**: Vercel 플랜이 Hobby라 Password Protection을 못 쓴다. `apps/dashboard/src/middleware.ts`에 HTTP Basic 인증을 넣고 `DASHBOARD_USER`/`DASHBOARD_PASSWORD`로 제어한다. 비밀번호가 없으면 프로덕션은 503(fail closed), 개발 서버는 통과.
  - `next start`로 6개 경우 확인: 미설정 503 / 헤더없음 401 / 틀린 비번 401 / 틀린 유저 401 / 정답 200 / 상세 페이지 200.
- **GitHub 푸시 완료 (2026-08-26)**: `3760e11..34649a4`, 미푸시 7개 커밋을 `origin/main`에 올렸다.
- **4단계 대시보드 배포 완료 (2026-08-26)**: https://vital-lens-dashboard.vercel.app — Vercel 팀 `aquaman122's projects`(Hobby), 프로젝트 `vital-lens-dashboard`, Root Directory `apps/dashboard`, 프로덕션 브랜치 `main`. 푸시하면 자동 배포된다.
  - env 4개 등록: `SUPABASE_URL`·`DASHBOARD_USER`는 non-sensitive(나중에 값 확인 가능), `SUPABASE_SECRET_KEY`·`DASHBOARD_PASSWORD`는 sensitive(write-only, 다시 못 읽는다). 넷 다 Production·Preview. `NEXT_PUBLIC_` 안 붙였다.
  - `DASHBOARD_PASSWORD`는 `openssl rand -base64 24`. **sensitive라 Vercel에서 다시 읽을 수 없다 — 비밀번호 관리자에 보관할 것.** 잃어버리면 새로 만들어 `--force`로 덮어쓰고 재배포하면 된다.
  - **Vercel CLI 계정이 둘로 갈려 있다.** `vital-lens-dashboard`는 `aquaman122` 계정, juntelecom 쪽(kt-market 등)은 `juntell` 계정. CLI는 한 번에 하나만 로그인되므로 작업 전에 `npx vercel whoami`로 확인할 것. Vercel MCP는 `aquaman122`에 붙어 있지만 **env 관리 도구가 없다**(프로젝트 생성·배포·로그·보호설정만) — env는 CLI로 해야 한다.
  - **Vercel이 이제 신규 env를 기본 secret visibility로 만든다.** `NEXT_PUBLIC_` 접두사가 붙은 변수는 Production/Preview에서 secret일 수 없어 `invalid_visibility`로 거부된다. `--no-sensitive`를 줘야 한다.
  - 시크릿은 채팅·로그에 찍지 않도록 파일에서 stdin으로 흘려 넣었다: `vercel env add NAME production,preview --sensitive < 파일`.
- **배포 후 검증 완료 (2026-08-26)**: 인증 없음 401 / 틀린 비번 401 / 틀린 유저 401 / 정답 200 / `/site/kt-market` 200. 401 응답에 `WWW-Authenticate: Basic realm="vital-lens"`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.
  - **fail closed를 실제 Vercel에서 확인했다.** env를 넣기 전 프로덕션 배포가 `HTTP/2 503` + "DASHBOARD_PASSWORD 미설정 — 대시보드를 열지 않습니다"를 반환했다. Hobby라 Vercel Password Protection을 못 쓰므로 이 미들웨어가 유일한 보호막이고, 그 보호막이 없으면 아예 안 열린다.
  - 프로덕션 대시보드가 kt-market 데이터를 렌더한다: LCP 카드 "좋음 692ms · p75", release 표 `dev / LCP p75 692 / 샘플 16`, 느린 페이지 `/ 692ms`, 에러 0건. Vercel 서버에서 secret key로 Supabase를 읽는 경로까지 관통 확인.
- **`vl_prune` pg_cron 스케줄 적용 (2026-08-26)**: 마이그레이션 `0003_schedule_vl_prune` — pg_cron 확장 + `cron.schedule('vl-prune', '0 18 * * *', ...)`. **pg_cron은 UTC 기준**이라 KST 03:00 = `0 18 * * *`. 같은 jobname은 덮어쓰므로 재적용 안전. `cron.job`에 jobid 1 active 확인, `vl_prune(90)` 수동 실행 0건 삭제/32행 유지 정상. 어드바이저 신규 이슈 없음(기존 3건은 설계 의도).
- **kt-market Vercel env 2개 등록 완료 (2026-08-26)**: `NEXT_PUBLIC_VITAL_LENS_URL`, `NEXT_PUBLIC_VITAL_LENS_KEY` — Production·Preview·Development. `juntell` 계정의 `kt-market` 프로젝트. 공개돼도 되는 값이라 non-sensitive.
- **v0.2 세 개 완료 (2026-08-26)**: INP attribution(`0004`), 일별 롤업(`0005`), Discord 웹훅 알림(`0006`). 전부 원격 적용·검증 완료.
  - **INP attribution**: `web-vitals/attribution` 빌드는 gzip 5032B(전체)·4558B(INP만 혼합)로 4KB 예산 위반이라 **안 쓴다**. 기본 `onINP`의 `metric.entries[0]`(PerformanceEventTiming)에서 target 셀렉터·interaction·input_delay/processing/presentation을 직접 계산 — +264B로 3647/4096. `vl_ingest` detail 화이트리스트에 5키 추가(`jsonb_strip_nulls`, 미지 키 폐기 유지), `vl_slow_interactions` 뷰 + 대시보드 "느린 인터랙션" 표. RPC로 악성 키 폐기·절단·집계까지 검증.
  - **일별 롤업**: `vl_daily_rollup` 테이블(RLS on·무정책) + `vl_rollup()`(멱등 upsert, `current_date-89` 하한으로 prune에 일부 잘린 날은 안 덮음) + cron `vl-rollup` 17:50 UTC(prune 10분 전). 대시보드는 `vl_daily_combined`(지난 날=롤업, 오늘=라이브)를 읽는다. 원시 90일, 집계 영구.
  - **웹훅 알림**: `vl_alert_check()` 매시 5분 — 최근 2일 release의 p75가 good 경계(LCP 2500/INP 200/CLS 0.1) 초과·샘플≥8이면 Discord POST(pg_net 비동기). `vl_alerts` (site,release,name) 유니크로 평생 1회. `dev`/`unknown` release 제외. **URL은 Vault `vl_discord_webhook` — 아직 미설정이라 no-op 상태.** 설정 즉시 다음 실행이 발송한다.
  - cron 잡 3개: `vl-rollup` 50 17 * * * / `vl-prune` 0 18 * * * / `vl-alerts` 5 * * * *.
  - **collector 갱신 미전파**: zini-pinlog·kt-market의 `public/vital-lens.min.js`는 아직 attribution 없는 구버전. 갱신법: `pnpm --filter @vital-lens/collector build` 후 각 리포 public/에 복사. detail 없는 INP 행은 새 뷰에서 그냥 빠진다(하위호환).
- npm publish는 보류(npm 미로그인). 발행 전 패키징(exports·README) 정리 필요.
- 아직 안 된 것: **kt-market 프로덕션에 collector 코드가 없다.** 부착 커밋 `c0597f8`은 `origin/dev`·`feat/phone-detail-page`·`feat/userinfo-direct-confirm`에만 있고 kt-market의 프로덕션 브랜치인 `origin/main`에는 없다. env는 넣어놨으니 다음 정규 릴리스(dev→main)에 collector가 실리면 그때부터 실트래픽이 들어온다. 그 전까지 대시보드에 쌓이는 건 로컬 `dev` release 데이터뿐이다.

### 보안 수정 기록 (2026-08-24)
`0001_init.sql`의 `revoke all on function ... from public` 만으로는 Supabase가 default privilege로 `anon`/`authenticated`에 준 EXECUTE가 남는다. 그 결과 publishable 키만으로 `vl_prune(0)` 을 호출해 `events` 전체를 지울 수 있었다. `revoke execute ... from anon, authenticated` 를 `0001_init.sql`에 추가하고 원격에는 `0002`로 적용. **함수 권한은 `from public` 이 아니라 역할을 명시해 회수할 것.**

## 다음 작업 순서
1. ~~**Supabase 연결**~~ 완료(secret key 포함).
2. ~~**수집 부착**~~ 완료(zini-pinlog `85f195b`).
3. ~~**검증**~~ 완료(LCP/FCP까지 확인, 위 참조).
4. ~~**배포**~~ 완료(대시보드 배포·검증, kt-market env). 남은 것 하나:
   - **kt-market 실트래픽 수집**: juntelecom `dev`가 `main`에 머지돼 프로덕션에 collector가 실려야 시작된다. 실리면 실브라우저 트래픽에서 LCP·CLS·INP가 쌓이는지 확인할 것 — 지금까지 확인한 CLS/INP 부재는 layout shift·상호작용이 0건이라 web-vitals가 보고하지 않은 것이지 버그가 아니다.
5. **v0.2**: ~~INP attribution~~(`0004`) · ~~웹훅 알림~~(`0006`, Vault URL 설정만 남음) · ~~일별 롤업~~(`0005`) · ~~`vl_prune` pg_cron~~(`0003`) 완료. 남은 것: `@vital-lens/collector` npm publish(그러면 README 방법 B가 실제로 가능), 부착 사이트 collector 파일 갱신.

## 지켜야 할 원칙
- 보안: 권한은 키가 아니라 함수에. anon에 테이블 정책을 만들지 않는다. secret key를 `NEXT_PUBLIC_`으로 노출하지 않는다.
- 개인정보: IP·UA 원문·쿠키·사용자 식별자 수집 금지. path는 쿼리스트링 제거, 에러 메시지 500자 절단 유지.
- 차트: 단일 축, 시리즈별 고정 색, 텍스트는 텍스트 토큰 색(시리즈 색 금지). 기존 `MetricTrend` 패턴을 따른다.
- collector 크기 예산: gzip 4KB 초과 금지. 의존성 추가 전에 크기를 확인한다(`pnpm --filter @vital-lens/collector size`).
- 철수 기준(PRD): 4주간 대시보드를 주 1회도 안 열면 아카이브. 이 기준을 지우지 말 것.

## 기록
- 의미 있는 결정·시행착오는 커밋 메시지에 남기고, 주 1회 Obsidian `LLM-Wiki`(raw/에 넣고 /ingest)로 옮긴다. 이 프로젝트는 면접 스토리("관측 부재로 겪은 실패를 도구로 해결")의 근거 자료다.
