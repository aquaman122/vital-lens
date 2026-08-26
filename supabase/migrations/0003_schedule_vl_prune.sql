-- 원시 이벤트 90일 보관을 자동화한다. 지금까지는 README의 "SQL Editor에서 주기 실행"
-- 안내뿐이라 사람이 잊으면 events가 무한히 자란다.
create extension if not exists pg_cron;

-- pg_cron 스케줄은 UTC 기준이다. 트래픽이 한산한 KST 03:00 = UTC 18:00.
-- cron.schedule 은 같은 jobname이면 덮어쓰므로 재실행해도 중복 잡이 생기지 않는다.
select cron.schedule('vl-prune', '0 18 * * *', $$select public.vl_prune(90)$$);
