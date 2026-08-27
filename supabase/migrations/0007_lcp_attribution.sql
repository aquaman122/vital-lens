-- LCP attribution: collector가 LCP 이벤트에 detail(target·lcp_url·시간 분해)을 실어 보낸다.
-- 0004와 같은 원칙 — detail은 화이트리스트로만 통과, 임의 키는 저장하지 않는다.
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
        jsonb_strip_nulls(jsonb_build_object(
          'message',      left(ev -> 'detail' ->> 'message', 500),
          'stack',        left(ev -> 'detail' ->> 'stack', 2000),
          'source',       left(ev -> 'detail' ->> 'source', 300),
          'target',       left(ev -> 'detail' ->> 'target', 200),
          'interaction',  left(ev -> 'detail' ->> 'interaction', 30),
          'input_delay',  case when jsonb_typeof(ev -> 'detail' -> 'input_delay') = 'number'
                               then least(greatest((ev -> 'detail' ->> 'input_delay')::double precision, 0), 600000) end,
          'processing',   case when jsonb_typeof(ev -> 'detail' -> 'processing') = 'number'
                               then least(greatest((ev -> 'detail' ->> 'processing')::double precision, 0), 600000) end,
          'presentation', case when jsonb_typeof(ev -> 'detail' -> 'presentation') = 'number'
                               then least(greatest((ev -> 'detail' ->> 'presentation')::double precision, 0), 600000) end,
          -- LCP attribution (0007)
          'lcp_url',      left(ev -> 'detail' ->> 'lcp_url', 300),
          'load_delay',   case when jsonb_typeof(ev -> 'detail' -> 'load_delay') = 'number'
                               then least(greatest((ev -> 'detail' ->> 'load_delay')::double precision, 0), 600000) end,
          'load_time',    case when jsonb_typeof(ev -> 'detail' -> 'load_time') = 'number'
                               then least(greatest((ev -> 'detail' ->> 'load_time')::double precision, 0), 600000) end,
          'render_delay', case when jsonb_typeof(ev -> 'detail' -> 'render_delay') = 'number'
                               then least(greatest((ev -> 'detail' ->> 'render_delay')::double precision, 0), 600000) end
        ))
      end
    );
  end loop;
end;
$$;

-- 함수 재생성 시 권한 재명시 (0002의 교훈).
revoke all on function public.vl_ingest(jsonb) from public;
revoke execute on function public.vl_ingest(jsonb) from anon, authenticated;
grant execute on function public.vl_ingest(jsonb) to anon;

-- LCP 요소 집계: 어떤 요소·리소스가 페이지의 LCP를 만드는가
create or replace view public.vl_lcp_elements as
select site_id,
       path,
       detail ->> 'target' as target,
       detail ->> 'lcp_url' as lcp_url,
       count(*) as samples,
       percentile_cont(0.75) within group (order by value) as p75,
       percentile_cont(0.75) within group (order by (detail ->> 'load_delay')::double precision) as load_delay_p75,
       percentile_cont(0.75) within group (order by (detail ->> 'load_time')::double precision) as load_time_p75,
       percentile_cont(0.75) within group (order by (detail ->> 'render_delay')::double precision) as render_delay_p75
from events
where type = 'metric' and name = 'LCP' and detail ? 'target'
group by 1, 2, 3, 4;

revoke all on public.vl_lcp_elements from anon, authenticated;
