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

Vercel에 배포한다면 env 두 개를 넣되, 대시보드가 공개되지 않게 Vercel의 Password Protection이나 사설 도메인 뒤에 둘 것 (v0.1은 자체 로그인이 없다).

## 수집 항목과 개인정보

메트릭 값, rating, path(쿼리스트링 제거), release, 기기 분류(mobile/tablet/desktop), 연결 유형, 세션 id(탭 단위 랜덤 uuid), 에러 message/stack(절단). **IP·UA 원문·쿠키·사용자 식별자는 수집하지 않는다.**

## 운영 메모

- 원시 이벤트는 90일 보관 권장: SQL Editor에서 `select vl_prune(90);` 를 주기 실행 (pg_cron 확장을 켰다면 `select cron.schedule('vl-prune', '0 3 * * *', $$select vl_prune(90)$$);`)
- 무료 티어 기준 하루 수만 이벤트까지는 무리 없음. 트래픽이 크면 `sampleRate: 0.1` 로.

## 로드맵 (v0.2 후보)

INP attribution(느린 인터랙션의 대상 요소), 웹훅 알림(배포 후 p75가 임계 초과 시), 일별 롤업 테이블로 집계 이전, 소스맵 심볼리케이션.
