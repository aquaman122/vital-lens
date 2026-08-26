-- 배포 후 p75 임계 초과 시 Discord 웹훅 알림 (PRD v0.2).
-- 대시보드를 열어야만 회귀를 보는 구조에서, 회귀가 먼저 찾아오는 구조로.
create extension if not exists pg_net;

-- (site, release, metric)당 한 번만 알린다 — 매시 검사해도 스팸이 없다.
create table if not exists public.vl_alerts (
  id bigint generated always as identity primary key,
  site_id text not null references public.sites (id),
  release text not null,
  name text not null,
  p75 double precision not null,
  samples bigint not null,
  sent_at timestamptz not null default now(),
  unique (site_id, release, name)
);

alter table public.vl_alerts enable row level security;
revoke all on public.vl_alerts from anon, authenticated;

-- 웹훅 URL은 Vault의 'vl_discord_webhook' 시크릿에서 읽는다. 코드·마이그레이션에 URL을 넣지 않는다.
-- 미설정이면 아무것도 기록하지 않고 0을 반환 — 설정된 뒤 첫 실행이 밀린 알림을 보낸다.
create or replace function public.vl_alert_check(min_samples int default 8)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  hook text;
  r record;
  sent int := 0;
  msg text;
begin
  select decrypted_secret into hook from vault.decrypted_secrets where name = 'vl_discord_webhook';
  if hook is null then
    return 0;
  end if;

  for r in
    select m.site_id, m.release, m.name, m.p75, m.samples
    from vl_release_metrics m
    where m.samples >= min_samples
      and m.last_seen > now() - interval '2 days'          -- 최근 배포만: 옛 release 재알림 방지
      and m.release not in ('dev', 'unknown')              -- 로컬/미식별 수집은 알리지 않는다
      and m.p75 > case m.name when 'LCP' then 2500 when 'INP' then 200 when 'CLS' then 0.1 end
      and not exists (
        select 1 from vl_alerts a
        where a.site_id = m.site_id and a.release = m.release and a.name = m.name
      )
  loop
    msg := format('**vital-lens** %s · release `%s` — %s p75 **%s** (샘플 %s, 임계 %s)',
                  r.site_id, r.release, r.name,
                  case when r.name = 'CLS' then round(r.p75::numeric, 3)::text
                       else round(r.p75)::text || 'ms' end,
                  r.samples,
                  case r.name when 'LCP' then '2500ms' when 'INP' then '200ms' else '0.1' end);
    -- pg_net은 비동기 큐: 실패해도 함수는 죽지 않고, 응답은 net._http_response에 남는다.
    perform net.http_post(
      url := hook,
      body := jsonb_build_object('content', msg),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
    insert into vl_alerts (site_id, release, name, p75, samples)
    values (r.site_id, r.release, r.name, r.p75, r.samples);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke all on function public.vl_alert_check(int) from public;
revoke execute on function public.vl_alert_check(int) from anon, authenticated;

-- 매시 5분. 수집은 계속 흐르고, 알림은 (site,release,metric) 유니크 제약이 한 번으로 막는다.
select cron.schedule('vl-alerts', '5 * * * *', $$select public.vl_alert_check()$$);
