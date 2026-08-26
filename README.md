# vital-lens

경량 RUM(Real User Monitoring). 스크립트 한 줄로 Core Web Vitals(LCP·INP·CLS·TTFB·FCP)와 JS 에러를 수집하고, **배포(release)별 회귀**를 대시보드로 본다. 수집 3.3KB(gzip), 데이터는 내 Supabase에.

왜 만들었는지·범위·철수 기준은 [docs/PRD.md](docs/PRD.md).

```
vital-lens/
├── packages/collector/    수집 스크립트 (web-vitals + 에러 → Supabase RPC)
├── apps/dashboard/        Next.js 대시보드 (서버 컴포넌트, secret key 서버 전용)
├── supabase/migrations/   스키마 + security definer RPC + 집계 뷰
└── docs/PRD.md
```

## 1. Supabase 준비 (5분)

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성 (무료 티어, 리전 ap-northeast-2 권장)
2. SQL Editor에 `supabase/migrations/0001_init.sql` 전체를 붙여넣고 실행
3. 사이트 등록:
   ```sql
   insert into sites (id, name) values ('my-app', '내 앱');
   ```
4. Settings → API 에서 **Project URL**과 **publishable(anon) key**, **secret(service_role) key**를 확보

보안 구조: RLS 전면 활성화 + anon 정책 없음. 쓰기는 `vl_ingest` RPC(security definer, 검증 후 insert-only)만 anon으로 실행 가능하고, 읽기는 대시보드 서버의 secret key만. **권한은 키가 아니라 함수에 있다.**

## 2. 수집 붙이기

### 방법 A — script 태그 (아무 사이트나)

```html
<script
  src="/vital-lens.min.js"
  data-endpoint="https://YOUR_PROJECT.supabase.co"
  data-key="YOUR_PUBLISHABLE_KEY"
  data-site="my-app"
  data-release="v1.2.3"
  defer
></script>
```

`packages/collector/dist/vital-lens.min.js` 를 빌드해서 정적 파일로 서빙. (`pnpm --filter @vital-lens/collector build`)

### 방법 B — Next.js에서 모듈로

```tsx
// app/rum.tsx
'use client';
import { useEffect } from 'react';
import { init } from '@vital-lens/collector';

export function Rum() {
  useEffect(() => {
    init({
      endpoint: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // publishable key
      site: 'my-app',
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
      sampleRate: 1,
    });
  }, []);
  return null;
}
```

`app/layout.tsx` 의 `<body>` 안에 `<Rum />` 한 번.

release에 커밋 SHA를 넣으면 대시보드의 "배포별 비교"가 배포 전후 p75를 나란히 보여준다 — 이게 이 도구의 존재 이유.

## 3. 대시보드 실행

```bash
cd apps/dashboard
cp .env.example .env.local   # SUPABASE_URL, SUPABASE_SECRET_KEY 채우기
pnpm install
pnpm dev                     # http://localhost:3100
```

### 대시보드 보호

대시보드에는 자체 로그인이 없고 수집 데이터를 그대로 보여준다. 그래서 HTTP Basic 인증 미들웨어가 앞에 있다:

```bash
DASHBOARD_USER=vital-lens
DASHBOARD_PASSWORD=충분히-긴-임의-문자열
```

`DASHBOARD_PASSWORD`가 비어 있으면 **프로덕션에서는 503으로 아예 열리지 않는다**(개발 서버는 통과 — 로컬에서 매번 입력할 이유가 없다). 비밀번호 없이 배포해도 데이터가 새지 않는다는 뜻이다.

Vercel의 Password Protection은 유료 플랜 기능이라 Hobby에서는 쓸 수 없다. 이 미들웨어는 플랜과 무관하게 동작한다. Pro라면 둘 다 켜도 된다.

Vercel에 배포한다면 env는 넷: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`. **어느 것에도 `NEXT_PUBLIC_`을 붙이지 않는다.** 모노레포이므로 프로젝트 Root Directory를 `apps/dashboard`로 지정한다.

## 수집 항목과 개인정보

메트릭 값, rating, path(쿼리스트링 제거), release, 기기 분류(mobile/tablet/desktop), 연결 유형, 세션 id(탭 단위 랜덤 uuid), 에러 message/stack(절단). **IP·UA 원문·쿠키·사용자 식별자는 수집하지 않는다.**

## 운영 메모

- 원시 이벤트는 90일 보관: `0003_schedule_vl_prune.sql`이 pg_cron으로 매일 KST 03:00(UTC 18:00)에 `vl_prune(90)`을 실행한다. pg_cron 없는 환경이면 SQL Editor에서 `select vl_prune(90);` 를 주기 실행.
- 무료 티어 기준 하루 수만 이벤트까지는 무리 없음. 트래픽이 크면 `sampleRate: 0.1` 로.

## 로드맵 (v0.2 후보)

~~INP attribution~~, ~~웹훅 알림~~, ~~일별 롤업~~ 완료(마이그레이션 `0004`~`0006`). 남은 후보: `@vital-lens/collector` npm publish, 소스맵 심볼리케이션.
