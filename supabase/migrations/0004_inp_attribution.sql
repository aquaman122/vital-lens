-- INP attribution: collector가 INP 이벤트에 detail(target·interaction·3단계 지연)을 실어 보낸다.
-- vl_ingest는 detail을 화이트리스트로만 통과시키므로 필드를 추가해야 한다 — 이 원칙은 유지:
-- 클라이언트가 보내는 임의 키는 절대 그대로 저장하지 않는다.
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
      -- jsonb_strip_nulls: 에러 이벤트에는 INP 키가, INP에는 에러 키가 null로 남지 않게
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
                               then least(greatest((ev -> 'detail' ->> 'presentation')::double precision, 0), 600000) end
        ))
      end
    );
  end loop;
end;
$$;

-- 함수를 재생성하면 권한이 초기화될 수 있으므로 회수·부여를 다시 명시한다 (0002의 교훈).
revoke all on function public.vl_ingest(jsonb) from public;
revoke execute on function public.vl_ingest(jsonb) from anon, authenticated;
grant execute on function public.vl_ingest(jsonb) to anon;

-- 느린 인터랙션 집계: 어떤 요소가 INP를 만드는가
create or replace view public.vl_slow_interactions as
select site_id,
       detail ->> 'target' as target,
       detail ->> 'interaction' as interaction,
       count(*) as samples,
       percentile_cont(0.75) within group (order by value) as p75,
       percentile_cont(0.75) within group (order by (detail ->> 'input_delay')::double precision) as input_delay_p75,
       percentile_cont(0.75) within group (order by (detail ->> 'processing')::double precision) as processing_p75,
       percentile_cont(0.75) within group (order by (detail ->> 'presentation')::double precision) as presentation_p75
from events
where type = 'metric' and name = 'INP' and detail ? 'target'
group by 1, 2, 3;

revoke all on public.vl_slow_interactions from anon, authenticated;
