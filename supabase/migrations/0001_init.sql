-- vital-lens v0.1 initial schema
-- 원칙: RLS 전면 활성화, anon에 테이블 정책 없음.
-- 쓰기는 security definer RPC(vl_ingest)만, 읽기는 대시보드 서버(secret key)만.

create table if not exists public.sites (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  site_id text not null references public.sites (id),
  session_id uuid not null,
  ts timestamptz not null default now(),
  type text not null check (type in ('metric', 'error', 'pageview')),
  name text not null,                -- LCP | INP | CLS | TTFB | FCP | 에러 name | pageview
  value double precision,            -- metric 값 (ms, CLS는 unitless)
  rating text check (rating in ('good', 'needs-improvement', 'poor')),
  path text not null default '/',
  release text not null default 'unknown',
  device text not null default 'unknown' check (device in ('mobile', 'tablet', 'desktop', 'unknown')),
  conn text,                         -- effectiveType: 4g, 3g ...
  detail jsonb                       -- 에러: { message, stack(절단), source }
);

create index if not exists events_site_ts_idx on public.events (site_id, ts desc);
create index if not exists events_site_type_name_idx on public.events (site_id, type, name, ts desc);
create index if not exists events_site_release_idx on public.events (site_id, release);

alter table public.sites enable row level security;
alter table public.events enable row level security;
-- 정책을 만들지 않는다: anon/authenticated는 테이블에 직접 접근 불가.

-- 수집 RPC: 권한은 키가 아니라 함수에 둔다.
create or replace function public.vl_ingest(batch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev jsonb;
  v_site text;
  v_count int;
begin
  if jsonb_typeof(batch -> 'events') <> 'array' then
    raise exception 'invalid payload';
  end if;

  v_count := jsonb_array_length(batch -> 'events');
  if v_count < 1 or v_count > 50 then
    raise exception 'batch size out of range';
  end if;

  v_site := batch ->> 'site';
  if not exists (select 1 from sites where id = v_site) then
    raise exception 'unknown site';
  end if;

  for ev in select * from jsonb_array_elements(batch -> 'events') loop
    if ev ->> 'type' not in ('metric', 'error', 'pageview') then
      continue;
    end if;
    insert into events (site_id, session_id, type, name, value, rating, path, release, device, conn, detail)
    values (
      v_site,
      coalesce((ev ->> 'sid')::uuid, gen_random_uuid()),
      ev ->> 'type',
      left(coalesce(ev ->> 'name', 'unknown'), 120),
      case when jsonb_typeof(ev -> 'value') = 'number'
           then least(greatest((ev ->> 'value')::double precision, 0), 600000)
           end,
      case when ev ->> 'rating' in ('good', 'needs-improvement', 'poor') then ev ->> 'rating' end,
      left(split_part(coalesce(ev ->> 'path', '/'), '?', 1), 300),
      left(coalesce(ev ->> 'release', 'unknown'), 60),
      case when ev ->> 'device' in ('mobile', 'tablet', 'desktop') then ev ->> 'device' else 'unknown' end,
      left(ev ->> 'conn', 10),
      case when ev -> 'detail' is not null then
        jsonb_build_object(
          'message', left(ev -> 'detail' ->> 'message', 500),
          'stack',   left(ev -> 'detail' ->> 'stack', 2000),
          'source',  left(ev -> 'detail' ->> 'source', 300)
        )
      end
    );
  end loop;
end;
$$;

revoke all on function public.vl_ingest(jsonb) from public;
grant execute on function public.vl_ingest(jsonb) to anon;

-- 집계 뷰 (대시보드 서버 전용 — secret key로 조회)
create or replace view public.vl_daily_metrics as
select site_id,
       date_trunc('day', ts)::date as day,
       name,
       device,
       count(*) as samples,
       percentile_cont(0.75) within group (order by value) as p75,
       percentile_cont(0.95) within group (order by value) as p95
from events
where type = 'metric'
group by 1, 2, 3, 4;

create or replace view public.vl_release_metrics as
select site_id,
       release,
       name,
       count(*) as samples,
       min(ts) as first_seen,
       max(ts) as last_seen,
       percentile_cont(0.75) within group (order by value) as p75
from events
where type = 'metric'
group by 1, 2, 3;

create or replace view public.vl_page_metrics as
select site_id,
       path,
       name,
       count(*) as samples,
       percentile_cont(0.75) within group (order by value) as p75
from events
where type = 'metric'
group by 1, 2, 3;

create or replace view public.vl_recent_errors as
select site_id, ts, name, path, release, device,
       detail ->> 'message' as message,
       detail ->> 'source' as source
from events
where type = 'error'
order by ts desc;

-- 뷰도 기본적으로 소유자 권한이므로 anon 노출 차단
revoke all on public.vl_daily_metrics, public.vl_release_metrics, public.vl_page_metrics, public.vl_recent_errors from anon, authenticated;
revoke all on public.sites, public.events from anon, authenticated;

-- 90일 지난 원시 이벤트 정리용 (pg_cron 있으면 스케줄, 없으면 수동)
create or replace function public.vl_prune(retention_days int default 90)
returns bigint
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from events where ts < now() - make_interval(days => retention_days) returning 1
  )
  select count(*) from deleted;
$$;
revoke all on function public.vl_prune(int) from public;
