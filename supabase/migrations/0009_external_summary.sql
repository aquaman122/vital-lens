-- 외부 지표 요약 뷰. vl_external_daily는 하루 4천행(URL 분해)이라 클라이언트가
-- 전 행을 가져오면 supabase-js 기본 1000행 제한에 잘린다 — 집계는 DB에서 한다.
-- 비율(_pct) 지표는 합산이 왜곡이라 제외.
create or replace view public.vl_external_summary as
select source, day, metric,
       sum(value) filter (where dim <> '') as dim_sum,
       max(value) filter (where dim = '')  as total
from vl_external_daily
where metric not like '%\_pct'
group by 1, 2, 3;

revoke all on public.vl_external_summary from anon, authenticated;
