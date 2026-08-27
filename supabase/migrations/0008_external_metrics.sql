-- 외부 지표(Clarity·GA4) 일별 적재. pull은 대시보드 서버의 Vercel Cron이 하고
-- service key로 쓴다(RLS 우회). anon에게는 여느 테이블처럼 정책이 없다 — 읽기·쓰기 불가.
create table if not exists vl_external_daily (
  source text not null check (source in ('clarity', 'ga4')),
  day date not null,
  metric text not null,
  dim text not null default '',       -- URL/pagePath 분해용. 전체 합계는 ''
  value double precision not null,
  pulled_at timestamptz not null default now(),
  primary key (source, day, metric, dim)
);
alter table vl_external_daily enable row level security;

-- 파싱 실수에 대비한 원본 스냅샷. 스키마가 바뀌어도 재파싱 가능.
create table if not exists vl_external_raw (
  source text not null,
  day date not null,
  payload jsonb not null,
  pulled_at timestamptz not null default now(),
  primary key (source, day)
);
alter table vl_external_raw enable row level security;
