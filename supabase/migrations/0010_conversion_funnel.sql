-- 전환 퍼널: vital-lens pageview에는 세션 id와 path 순서가 있으므로
-- GA4 집계로는 불가능한 세션 단위 퍼널을 우리 데이터만으로 만든다.
-- 퍼널 정의: /phone/[slug] 상세 도달 → /phone/user-info → /phone/write/completion.
-- 근사치임을 명시: 단계 방문의 시간 순서까지는 강제하지 않는다(완료 페이지를 먼저 볼 일은 사실상 없다).

create or replace view public.vl_funnel as
with sess as (
  select site_id, session_id,
         (array_agg(path order by ts) filter (
           where path like '/phone/%'
             and path not in ('/phone', '/phone/user-info', '/phone/write/completion')
         ))[1] as first_detail,
         bool_or(path = '/phone/user-info') as reached_info,
         bool_or(path = '/phone/write/completion') as converted
  from events
  where type = 'pageview'
  group by 1, 2
)
select site_id,
       first_detail as path,
       count(*) as sessions,
       count(*) filter (where reached_info) as info_sessions,
       count(*) filter (where converted) as conversions,
       round(100.0 * count(*) filter (where converted) / count(*), 1) as cvr_pct
from sess
where first_detail is not null
group by 1, 2;

revoke all on public.vl_funnel from anon, authenticated;

-- 속도-전환 상관: 세션이 겪은 최악의 LCP 구간별 전환율.
-- 상관이지 인과가 아니다 — 대시보드에도 그렇게 쓴다.
create or replace view public.vl_speed_vs_conversion as
with s as (
  select site_id, session_id,
         max(value) filter (where type = 'metric' and name = 'LCP') as worst_lcp,
         bool_or(type = 'pageview' and path = '/phone/write/completion') as converted
  from events
  group by 1, 2
)
select site_id,
       case when worst_lcp <= 2500 then 'good'
            when worst_lcp <= 4000 then 'needs-improvement'
            else 'poor' end as lcp_bucket,
       count(*) as sessions,
       count(*) filter (where converted) as conversions,
       round(100.0 * count(*) filter (where converted) / count(*), 1) as cvr_pct
from s
where worst_lcp is not null
group by 1, 2;

revoke all on public.vl_speed_vs_conversion from anon, authenticated;
