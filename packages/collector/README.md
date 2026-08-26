# @vital-lens/collector

경량 RUM 수집기 — Core Web Vitals(LCP·INP·CLS·TTFB·FCP), INP attribution(느린 인터랙션의 대상 요소와 시간 분해), JS 에러를 **내 Supabase**로 보낸다. 3.7KB gzip, 의존성은 `web-vitals` 하나.

서버 사이드 스키마·대시보드·보안 구조는 [vital-lens 리포](https://github.com/aquaman122/vital-lens) 참조. 수집 전에 `supabase/migrations/`의 스키마(RLS + `vl_ingest` RPC)가 적용된 Supabase 프로젝트가 필요하다.

## 설치

```bash
npm install @vital-lens/collector
```

## 사용 — Next.js (App Router)

```tsx
// app/rum.tsx
'use client';
import { useEffect } from 'react';
import { init } from '@vital-lens/collector';

export function Rum() {
  useEffect(() => {
    init({
      endpoint: process.env.NEXT_PUBLIC_VITAL_LENS_URL!,   // https://xxxx.supabase.co
      apiKey: process.env.NEXT_PUBLIC_VITAL_LENS_KEY!,     // publishable(anon) key
      site: 'my-app',                                       // sites 테이블에 등록한 id
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
      sampleRate: 1,
    });
  }, []);
  return null;
}
```

`app/layout.tsx`의 `<body>` 안에 `<Rum />` 한 번.

## 사용 — script 태그

```html
<script
  src="https://unpkg.com/@vital-lens/collector/dist/vital-lens.min.js"
  data-endpoint="https://YOUR_PROJECT.supabase.co"
  data-key="YOUR_PUBLISHABLE_KEY"
  data-site="my-app"
  data-release="v1.2.3"
  defer
></script>
```

## 개인정보

메트릭 값·rating·path(쿼리스트링 제거)·release·기기 분류·연결 유형·세션 id(탭 단위 랜덤)·에러 message/stack(절단)만 수집한다. **IP·UA 원문·쿠키·사용자 식별자는 수집하지 않는다.** publishable key는 공개돼도 되는 값이다 — 쓰기는 검증하는 RPC만 통과하고 읽기는 막혀 있다.

## License

MIT
