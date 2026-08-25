import Link from 'next/link';
import MetricTrend, { type Point } from '@/components/MetricTrend';
import { fetchDaily, fetchErrors, fetchPages, fetchReleases } from '@/lib/db';

export const dynamic = 'force-dynamic';

const METRICS = [
  { name: 'LCP', unit: 'ms', goodMax: 2500, poorMin: 4000, decimals: 0 },
  { name: 'INP', unit: 'ms', goodMax: 200, poorMin: 500, decimals: 0 },
  { name: 'CLS', unit: '', goodMax: 0.1, poorMin: 0.25, decimals: 3 },
] as const;

function fmtMetric(name: string, v: number | null): string {
  if (v == null) return '–';
  return name === 'CLS' ? v.toFixed(3) : Math.round(v).toLocaleString();
}

export default async function SitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const [daily, releases, pages, errors] = await Promise.all([
    fetchDaily(siteId),
    fetchReleases(siteId),
    fetchPages(siteId),
    fetchErrors(siteId),
  ]);

  // 디바이스 합산: 일별로 samples 가중 없이 단순 p75 재계산은 불가하므로 device='mobile' 우선, 없으면 전체 중 최대 샘플 device
  const byMetric = (metric: string): Point[] => {
    const rows = daily.filter((d) => d.name === metric && d.p75 != null);
    const days = [...new Set(rows.map((r) => r.day))].sort();
    return days.map((day) => {
      const sameDay = rows.filter((r) => r.day === day);
      const pick =
        sameDay.find((r) => r.device === 'mobile') ??
        sameDay.reduce((a, b) => (a.samples >= b.samples ? a : b));
      const samples = sameDay.reduce((n, r) => n + r.samples, 0);
      return { day, p75: pick.p75 as number, samples };
    });
  };

  const releaseNames = [...new Set(releases.map((r) => r.release))].slice(0, 8);

  return (
    <>
      <p style={{ marginBottom: 8 }}>
        <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← 사이트 목록
        </Link>
      </p>
      <h1 className="mono">{siteId}</h1>
      <p className="sub">최근 28일 · p75 기준 · 모바일 우선 표시</p>

      <div className="grid3">
        {METRICS.map((m) => (
          <MetricTrend
            key={m.name}
            title={m.name}
            unit={m.unit}
            points={byMetric(m.name)}
            goodMax={m.goodMax}
            poorMin={m.poorMin}
            decimals={m.decimals}
          />
        ))}
      </div>

      <h2>배포(release)별 비교</h2>
      <div className="card tablewrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>release</th>
              <th className="num">LCP p75</th>
              <th className="num">INP p75</th>
              <th className="num">CLS p75</th>
              <th className="num">샘플</th>
              <th className="num">마지막 수집</th>
            </tr>
          </thead>
          <tbody>
            {releaseNames.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  데이터 없음
                </td>
              </tr>
            )}
            {releaseNames.map((rel) => {
              const rows = releases.filter((r) => r.release === rel);
              const get = (n: string) => rows.find((r) => r.name === n);
              const samples = rows.reduce((s, r) => s + r.samples, 0);
              const last = rows.map((r) => r.last_seen).sort().at(-1);
              return (
                <tr key={rel}>
                  <td className="mono">{rel}</td>
                  <td className="num">{fmtMetric('LCP', get('LCP')?.p75 ?? null)}</td>
                  <td className="num">{fmtMetric('INP', get('INP')?.p75 ?? null)}</td>
                  <td className="num">{fmtMetric('CLS', get('CLS')?.p75 ?? null)}</td>
                  <td className="num">{samples.toLocaleString()}</td>
                  <td className="num" style={{ color: 'var(--text-muted)' }}>
                    {last ? new Date(last).toISOString().slice(0, 16).replace('T', ' ') : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>느린 페이지 (LCP p75)</h2>
      <div className="card tablewrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>path</th>
              <th className="num">LCP p75 (ms)</th>
              <th className="num">샘플</th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                  데이터 없음
                </td>
              </tr>
            )}
            {pages.map((p) => (
              <tr key={p.path}>
                <td className="mono">{p.path}</td>
                <td className="num">{fmtMetric('LCP', p.p75)}</td>
                <td className="num">{p.samples.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>최근 에러</h2>
      <div className="card tablewrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>시각</th>
              <th>에러</th>
              <th>메시지</th>
              <th>path</th>
              <th>release</th>
            </tr>
          </thead>
          <tbody>
            {errors.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                  에러 없음 🎉
                </td>
              </tr>
            )}
            {errors.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                  {new Date(e.ts).toISOString().slice(5, 16).replace('T', ' ')}
                </td>
                <td>
                  <span className="badge">
                    <span className="dot" style={{ background: 'var(--status-critical)' }} />
                    {e.name}
                  </span>
                </td>
                <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.message}
                </td>
                <td className="mono">{e.path}</td>
                <td className="mono">{e.release}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
