import Link from 'next/link';
import MetricTrend, { type Point } from '@/components/MetricTrend';
import { fetchDaily, fetchErrors, fetchExternalDaily, fetchLcpElements, fetchPages, fetchReleases, fetchSlowInteractions } from '@/lib/db';

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
  const [daily, releases, pages, errors, interactions, lcpElements, external] = await Promise.all([
    fetchDaily(siteId),
    fetchReleases(siteId),
    fetchPages(siteId),
    fetchErrors(siteId),
    fetchSlowInteractions(siteId),
    fetchLcpElements(siteId),
    fetchExternalDaily(),
  ]);

  // path 조인: LCP 나쁜 페이지 × GA4 트래픽 × Clarity 문제 행동.
  // "어딜 고쳐야 하나"에 답하는 표 — 트래픽이 많고 느린 페이지가 위로 온다.
  const ga4ByPath = new Map<string, number>();
  const clarityByPath = new Map<string, { rage: number; dead: number }>();
  for (const e of external) {
    if (!e.dim) continue;
    if (e.source === 'ga4' && e.metric === 'sessions') {
      ga4ByPath.set(e.dim, (ga4ByPath.get(e.dim) ?? 0) + e.value);
    }
    if (e.source === 'clarity') {
      let path = e.dim;
      try {
        path = new URL(e.dim).pathname;
      } catch {}
      const cur = clarityByPath.get(path) ?? { rage: 0, dead: 0 };
      if (e.metric === 'RageClickCount') cur.rage += e.value;
      if (e.metric === 'DeadClickCount') cur.dead += e.value;
      clarityByPath.set(path, cur);
    }
  }
  const problems = pages
    .map((p) => ({
      path: p.path,
      lcp: p.p75,
      samples: p.samples,
      sessions: ga4ByPath.get(p.path) ?? null,
      rage: clarityByPath.get(p.path)?.rage ?? null,
      dead: clarityByPath.get(p.path)?.dead ?? null,
    }))
    .sort((a, b) => (b.lcp ?? 0) * Math.log1p(b.sessions ?? 0) - (a.lcp ?? 0) * Math.log1p(a.sessions ?? 0))
    .slice(0, 10);
  const hasExternal = external.length > 0;

  // 외부 지표 요약: 가장 최근 적재일 기준. GA4는 합계 행(dim='')이 있고,
  // Clarity는 URL 분해 행뿐이라 count성 지표만 합산한다(_pct는 합산이 왜곡이라 제외).
  const latestDay = external.reduce((m, e) => (e.day > m ? e.day : m), '');
  const latest = external.filter((e) => e.day === latestDay);
  const ga4Total = (metric: string): number | null =>
    latest.find((e) => e.source === 'ga4' && e.metric === metric && e.dim === '')?.value ?? null;
  const claritySum = (metric: string): number | null => {
    const rows = latest.filter((e) => e.source === 'clarity' && e.metric === metric && e.dim !== '');
    return rows.length ? rows.reduce((n, e) => n + e.value, 0) : null;
  };
  const clarityTop = (metric: string) =>
    latest
      .filter((e) => e.source === 'clarity' && e.metric === metric && e.dim !== '' && e.value > 0)
      .map((e) => {
        let path = e.dim;
        try {
          path = new URL(e.dim).pathname;
        } catch {}
        return { path, value: e.value };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  const rageTop = clarityTop('RageClickCount');
  const deadTop = clarityTop('DeadClickCount');
  const fmtInt = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString());

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

      {hasExternal && (
        <>
          <h2>외부 지표 요약 ({latestDay})</h2>
          <div className="grid3">
            <div className="card">
              <h3>GA4 트래픽</h3>
              <table>
                <tbody>
                  <tr><td>세션</td><td className="num">{fmtInt(ga4Total('sessions'))}</td></tr>
                  <tr><td>사용자</td><td className="num">{fmtInt(ga4Total('activeUsers'))}</td></tr>
                  <tr><td>페이지뷰</td><td className="num">{fmtInt(ga4Total('screenPageViews'))}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Clarity 문제 행동 (합산)</h3>
              <table>
                <tbody>
                  <tr><td>rage click</td><td className="num">{fmtInt(claritySum('RageClickCount'))}</td></tr>
                  <tr><td>dead click</td><td className="num">{fmtInt(claritySum('DeadClickCount'))}</td></tr>
                  <tr><td>error click</td><td className="num">{fmtInt(claritySum('ErrorClickCount'))}</td></tr>
                  <tr><td>quickback</td><td className="num">{fmtInt(claritySum('QuickbackClick'))}</td></tr>
                  <tr><td>script error</td><td className="num">{fmtInt(claritySum('ScriptErrorCount'))}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>행동 문제 top 페이지</h3>
              <table>
                <tbody>
                  {rageTop.map((r) => (
                    <tr key={`r${r.path}`}>
                      <td className="mono">{r.path}</td>
                      <td className="num">rage {fmtInt(r.value)}</td>
                    </tr>
                  ))}
                  {deadTop.map((r) => (
                    <tr key={`d${r.path}`}>
                      <td className="mono">{r.path}</td>
                      <td className="num">dead {fmtInt(r.value)}</td>
                    </tr>
                  ))}
                  {rageTop.length + deadTop.length === 0 && (
                    <tr><td style={{ color: 'var(--text-muted)' }}>문제 행동 없음 🎉</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <h2>문제 후보 (LCP × 트래픽 × 행동)</h2>
          <p className="sub">느린데 트래픽까지 많은 페이지가 위로. rage/dead click은 Clarity, 세션은 GA4.</p>
          <div className="card tablewrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>path</th>
                  <th className="num">LCP p75 (ms)</th>
                  <th className="num">세션(GA4)</th>
                  <th className="num">rage click</th>
                  <th className="num">dead click</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((p) => (
                  <tr key={p.path}>
                    <td className="mono">{p.path}</td>
                    <td className="num">{fmtMetric('LCP', p.lcp)}</td>
                    <td className="num">{p.sessions == null ? '–' : p.sessions.toLocaleString()}</td>
                    <td className="num">{p.rage == null ? '–' : p.rage.toLocaleString()}</td>
                    <td className="num">{p.dead == null ? '–' : p.dead.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>LCP 요소 (무엇이 페이지를 느리게 하나)</h2>
      <div className="card tablewrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>path</th>
              <th>대상 요소</th>
              <th className="num">LCP p75 (ms)</th>
              <th className="num">로드 지연</th>
              <th className="num">로드</th>
              <th className="num">렌더 지연</th>
              <th className="num">샘플</th>
            </tr>
          </thead>
          <tbody>
            {lcpElements.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                  아직 데이터가 없습니다 — attribution 빌드 배포 후부터 쌓입니다
                </td>
              </tr>
            )}
            {lcpElements.map((l) => (
              <tr key={`${l.path}|${l.target}|${l.lcp_url}`}>
                <td className="mono">{l.path}</td>
                <td className="mono" title={l.lcp_url ?? undefined}>
                  {l.target}
                </td>
                <td className="num">{fmtMetric('LCP', l.p75)}</td>
                <td className="num">{fmtMetric('LCP', l.load_delay_p75)}</td>
                <td className="num">{fmtMetric('LCP', l.load_time_p75)}</td>
                <td className="num">{fmtMetric('LCP', l.render_delay_p75)}</td>
                <td className="num">{l.samples.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>느린 인터랙션 (INP p75)</h2>
      <div className="card tablewrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>대상 요소</th>
              <th>동작</th>
              <th className="num">INP p75 (ms)</th>
              <th className="num">입력 지연</th>
              <th className="num">처리</th>
              <th className="num">표시</th>
              <th className="num">샘플</th>
            </tr>
          </thead>
          <tbody>
            {interactions.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                  데이터 없음 — attribution은 collector 갱신 이후 수집분부터 쌓인다
                </td>
              </tr>
            )}
            {interactions.map((it) => (
              <tr key={`${it.target}|${it.interaction}`}>
                <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.target}
                </td>
                <td>{it.interaction}</td>
                <td className="num">{fmtMetric('INP', it.p75)}</td>
                <td className="num">{fmtMetric('INP', it.input_delay_p75)}</td>
                <td className="num">{fmtMetric('INP', it.processing_p75)}</td>
                <td className="num">{fmtMetric('INP', it.presentation_p75)}</td>
                <td className="num">{it.samples.toLocaleString()}</td>
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
