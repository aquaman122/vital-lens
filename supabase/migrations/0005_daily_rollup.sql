-- 일별 롤업: 지금은 vl_daily_metrics 뷰가 매 요청 원시 events를 퍼센타일 재계산한다.
-- 롤업 테이블은 (1) 대시보드 읽기를 상수 크기로 만들고 (2) vl_prune(90) 이후에도
-- 일별 p75 역사를 남긴다 — 원시는 90일, 집계는 영구.
create table if not exists public.vl_daily_rollup (
  site_id text not null references public.sites (id),
  day date not null,
  name text not null,
  device text not null,
  samples bigint not null,
  p75 double precision,
  p95 double precision,
  primary key (site_id, day, name, device)
);

alter table public.vl_daily_rollup enable row level security;
-- 정책 없음: anon/authenticated 직접 접근 불가 (events와 동일한 원칙)
revoke all on public.vl_daily_rollup from anon, authenticated;

-- 어제까지(단, prune 경계 안쪽만)를 upsert. 밤에 한 번 돌지만 멱등이라
-- 며칠 놓쳐도 다음 실행이 스스로 메운다.
-- 하한 current_date - 89: vl_prune(90)이 일부만 지운 날을 재계산하면
-- 줄어든 샘플로 완성된 롤업을 덮어쓰게 되므로, 원시가 온전한 날만 만진다.
create or replace function public.vl_rollup()
returns bigint
language sql
security definer
set search_path = public
as $$
  with up as (
    insert into vl_daily_rollup (site_id, day, name, device, samples, p75, p95)
    select site_id,
           date_trunc('day', ts)::date,
           name,
           device,
           count(*),
           percentile_cont(0.75) within group (order by value),
           percentile_cont(0.95) within group (order by value)
    from events
    where type = 'metric'
      and ts >= current_date - 89
      and ts < current_date
    group by 1, 2, 3, 4
    on conflict (site_id, day, name, device) do update
      set samples = excluded.samples, p75 = excluded.p75, p95 = excluded.p95
    returning 1
  )
  select count(*) from up;
$$;

revoke all on function public.vl_rollup() from public;
revoke execute on function public.vl_rollup() from anon, authenticated;

-- 대시보드가 읽는 결합 뷰: 지난 날은 롤업, 오늘은 라이브.
-- (오늘은 아직 롤업이 없고, 지난 날 롤업이 이가 빠졌다면 다음 vl_rollup 실행이 메운다)
create or replace view public.vl_daily_combined as
select site_id, day, name, device, samples, p75, p95 from vl_daily_rollup
union all
select site_id, day, name, device, samples, p75, p95 from vl_daily_metrics
where day >= current_date;

revoke all on public.vl_daily_combined from anon, authenticated;

-- prune(18:00 UTC)보다 먼저 돌아 원시가 지워지기 전에 집계를 굳힌다. 17:50 UTC = KST 02:50.
select cron.schedule('vl-rollup', '50 17 * * *', $$select public.vl_rollup()$$);
