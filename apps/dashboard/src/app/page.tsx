import Link from 'next/link';
import { fetchSites } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let sites: Awaited<ReturnType<typeof fetchSites>> = [];
  let err: string | null = null;
  try {
    sites = await fetchSites();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <h1>vital-lens</h1>
      <p className="sub">Core Web Vitals · JS 에러 · 배포별 회귀</p>

      {err ? (
        <div className="card">
          <strong>연결 안 됨</strong>
          <p style={{ color: 'var(--text-secondary)' }}>{err}</p>
          <p style={{ color: 'var(--text-muted)' }}>
            <code className="mono">apps/dashboard/.env.local</code> 에 SUPABASE_URL / SUPABASE_SECRET_KEY 를 설정하고,{' '}
            <code className="mono">supabase/migrations/0001_init.sql</code> 을 적용하세요.
          </p>
        </div>
      ) : sites.length === 0 ? (
        <div className="card">
          <strong>등록된 사이트가 없습니다</strong>
          <p style={{ color: 'var(--text-secondary)' }}>
            Supabase SQL Editor에서: <code className="mono">{`insert into sites (id, name) values ('my-app', '내 앱');`}</code>
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>사이트</th>
                <th>id</th>
                <th className="num">등록일</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/site/${s.id}`} style={{ fontWeight: 600 }}>
                      {s.name}
                    </Link>
                  </td>
                  <td className="mono">{s.id}</td>
                  <td className="num" style={{ color: 'var(--text-muted)' }}>
                    {new Date(s.created_at).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
