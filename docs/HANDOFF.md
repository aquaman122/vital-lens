# vital-lens 작업 현황 정리 (2026-08-27)

> 이 문서는 스냅샷이다. 살아있는 인수인계 문서는 [NEXT.md](NEXT.md) — 이후 작업은 그쪽을 갱신할 것.

## 1. 완성된 것들

### 파이프라인 전체 (v0.1)
- **collector** (`packages/collector`): web-vitals 5종(LCP·INP·CLS·TTFB·FCP) + JS 에러 + pageview 수집, 배치 전송. 3.6KB gzip — 4KB 예산 내.
- **ingest**: Supabase security definer RPC `vl_ingest` 하나로만 쓰기. anon 키에는 테이블 권한이 전혀 없다("권한은 키가 아니라 함수에"). 검증(사이트 존재·배열 크기·문자열 절단·값 클램프) 전항목 테스트 통과.
- **dashboard**: Next.js 15 서버 컴포넌트. p75 추이·release별 비교·느린 페이지·느린 인터랙션·에러 목록. secret key는 서버 전용.
- **실데이터 관통 확인**: 실브라우저에서 kt-market LCP 692ms·FCP 460/984ms가 collector → RPC → 집계 뷰 → 대시보드 UI까지 도달.

### 배포 (4단계)
- **대시보드 프로덕션**: https://vital-lens-dashboard.vercel.app
  - Vercel `aquaman122's projects`(Hobby), Root Directory `apps/dashboard`, `main` 푸시 시 자동 배포.
  - env 4개(`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`) — 전부 서버 전용, `NEXT_PUBLIC_` 없음. 시크릿 2개는 sensitive(write-only)로 등록, 채팅·로그에 노출 없음.
  - **HTTP Basic 인증 검증 완료**: 인증 없음/틀린 비번/틀린 유저 401, 정답 200, 비밀번호 미설정 시 503(fail closed) — 실제 Vercel 프로덕션에서 확인.
- **kt-market Vercel env**: `NEXT_PUBLIC_VITAL_LENS_URL/_KEY` Production·Preview·Development 등록 완료(공개 가능 값).

### DB 운영 자동화 (v0.2)
전부 원격 적용·검증 완료. pg_cron 잡 3개가 돈다 (**pg_cron은 UTC 기준**):

| 잡 | 스케줄 (UTC) | 하는 일 |
|---|---|---|
| `vl-rollup` | 50 17 * * * (KST 02:50) | 일별 p75를 `vl_daily_rollup`에 멱등 upsert |
| `vl-prune` | 0 18 * * * (KST 03:00) | 90일 지난 원시 이벤트 삭제 |
| `vl-alerts` | 5 * * * * (매시 5분) | release p75가 good 경계 초과 시 Discord 웹훅 (현재 URL 미설정이라 no-op) |

- **INP attribution** (`0004`): 느린 인터랙션의 대상 요소 셀렉터 + input_delay/processing/presentation 분해. `web-vitals/attribution` 빌드는 예산 초과라 버리고 기본 `onINP`의 entries에서 직접 계산(+264B). 대시보드에 "느린 인터랙션" 표 추가.
- **일별 롤업** (`0005`): 원시는 90일, 집계는 영구. 대시보드는 지난 날=롤업, 오늘=라이브를 합쳐 읽는다.
- **웹훅 알림** (`0006`): (site, release, metric) 당 평생 1회, `dev`/`unknown` release 제외, 샘플 8개 미만 무시.
- **보안 수정**: `vl_prune` EXECUTE를 anon·authenticated에서 명시 회수 — publishable 키만으로 전체 이벤트를 지울 수 있던 구멍 (`0002`, 교훈은 NEXT.md 보안 기록 참조).

### npm 발행 준비
- `@vital-lens/collector` — 레지스트리에서 이름 비어 있음 확인. exports 맵·repository·keywords·`publishConfig.access=public`·unpkg/jsdelivr 엔트리·MIT LICENSE·패키지 README 완비.
- `prepublishOnly`가 재빌드 + gzip 4096B 게이트를 강제 — 예산 초과 빌드는 발행이 실패한다.
- `npm pack --dry-run`: 6파일 7.4KB.

## 2. 이때까지 한 작업들 (시간순)

| 단계 | 내용 | 커밋/마이그레이션 |
|---|---|---|
| 1. Supabase 연결 | 프로젝트 생성(ap-northeast-2), 스키마 적용, `sites` 등록 | `0001`, `0002` |
| 2. 수집 부착 | zini-pinlog(`85f195b`), kt-market(juntelecom `c0597f8`) — 정적 파일 방식 | `9ccf2f7`, `8fd7b69` |
| 3. 검증 | RPC 방어 전항목, 실브라우저 LCP/FCP 관통, 서버→클라이언트 함수 props 버그 수정 | `7786bcf`, `b0c240b` |
| 4. 배포 | Basic 인증 미들웨어, GitHub 푸시(7커밋), Vercel 배포·env·검증, kt-market env | `34649a4`, `29876bb` |
| 5. v0.2 | pg_cron prune → INP attribution → 일별 롤업 → 웹훅 알림 | `8ac7903`, `e6f6675`, `5815f78`, `95b4cee`, `0003`~`0006` |
| 6. 발행 준비 | collector 패키징, kt-market에 새 빌드 복사(커밋은 미완) | `5283086` |

시행착오 중 기록 가치가 있는 것은 각 커밋 메시지와 NEXT.md에 있다. 핵심 몇 개:
- 서버 컴포넌트 → 클라이언트 컴포넌트로 **함수를 넘기면 렌더에서만 500**이 난다(빌드·타입체크는 통과).
- **LCP/CLS/INP는 자동화 브라우저로 확인 불가** — 화면에 실제로 보이는 페이지에만 생성된다. 이 확인은 항상 사람 몫.
- pg_cron은 UTC로 돈다. `0 3 * * *`를 그대로 넣으면 KST 정오 실행.
- Vercel은 신규 env를 기본 secret visibility로 만든다. `NEXT_PUBLIC_` 변수는 `--no-sensitive`가 필요하다.

## 3. 사람이 해야 하는 것들

우선순위 순:

1. **juntelecom에 collector 갱신 커밋** — 파일 교체는 끝났고 커밋만 남았다(자동화가 다른 리포 커밋을 못 한다):
   ```bash
   cd /Users/apple/Documents/GitHub/juntelecom && git add apps/kt-market/public/vital-lens.min.js && git commit -m "chore(kt-market): update vital-lens collector to the INP-attribution build"
   ```
   현재 브랜치 `feat/userinfo-direct-confirm`에 다른 수정 2건이 있으니 그것과 섞이지 않게 위 명령 그대로(해당 파일만 add).

2. **kt-market 프로덕션 릴리스 (dev→main)** — collector 부착 커밋이 `origin/dev`에만 있고 프로덕션 브랜치 `main`에는 없다. env는 준비돼 있으므로 다음 정규 릴리스에 실리는 순간부터 실트래픽 수집이 시작된다. **이게 되기 전까지 대시보드에 쌓이는 건 로컬 `dev` 데이터뿐이다.**

3. **npm publish** — npm 로그인이 필요해서 자동화 불가:
   ```bash
   npm login
   ```
   npm에서 `vital-lens` organization 생성(스코프 패키지 필수), 그 후:
   ```bash
   cd /Users/apple/Documents/GitHub/vital-lens/packages/collector && npm publish
   ```
   org를 만들기 싫으면 `package.json`의 name 스코프를 본인 계정명으로 변경. 발행되면 README "방법 B"(모듈 import)가 실제로 동작한다.

4. **Discord 웹훅 URL 설정** — 웹훅 알림이 현재 no-op이다. Discord 서버에서 웹훅 URL을 만들고 Supabase Vault에 `vl_discord_webhook`으로 저장(SQL Editor에서 가능). 저장 즉시 다음 `vl-alerts` 실행(매시 5분)부터 발송된다. Supabase MCP로 하려면 대화형 세션에서 `/mcp` 재인증 필요.

5. ~~zini-pinlog collector 갱신~~ — 2026-08-27 관측 대상에서 제거됨(`sites` 삭제). 리포에 남은 부착 코드(`public/vital-lens.min.js`, `Rum.tsx`)는 클론 접근 가능할 때 걷어내면 된다 — 남아 있어도 `unknown site`로 거부돼 데이터는 안 쌓인다.

6. **Vercel CLI 계정 확인 습관** — 현재 `aquaman122`로 로그인돼 있다. juntelecom 쪽(kt-market 등) 작업 전에는 `npx vercel whoami` 확인 후 필요 시 `juntell`로 재로그인.

7. **(확인) DASHBOARD_PASSWORD 보관** — Vercel에 sensitive로 들어가 다시 읽을 수 없다. 비밀번호 관리자 보관은 이미 했다고 했으니, 잃어버린 경우에만: 새 값 생성 → `vercel env add DASHBOARD_PASSWORD production,preview --sensitive --force` → 재배포.
