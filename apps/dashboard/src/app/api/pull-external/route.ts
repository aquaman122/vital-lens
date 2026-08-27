import { NextResponse, type NextRequest } from 'next/server';
import { createSign } from 'crypto';
import { db } from '@/lib/db';

/**
 * 외부 지표(Clarity·GA4)를 하루 한 번 당겨 Supabase에 적재한다.
 * Vercel Cron이 호출한다 — CRON_SECRET Bearer가 없으면 거부(fail closed).
 * Clarity Data Export는 하루 10요청 제한이라 이 크론 외의 호출 경로를 만들지 않는다.
 */

export const dynamic = 'force-dynamic';

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** KST 기준 어제 날짜 (GA4 캘린더 일과 Clarity 최근 24h 창을 이 날에 귀속) */
function kstYesterday(): string {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type Row = { source: 'clarity' | 'ga4'; day: string; metric: string; dim: string; value: number };

// ---------- Clarity ----------

async function pullClarity(day: string): Promise<{ rows: Row[]; raw: unknown }> {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) return { rows: [], raw: null };
  const res = await fetch(
    'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1&dimension1=URL',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`clarity ${res.status}`);
  const data = (await res.json()) as Array<{
    metricName: string;
    information?: Array<Record<string, unknown>>;
  }>;

  const rows: Row[] = [];
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (const m of data ?? []) {
    for (const info of m.information ?? []) {
      // URL 분해가 요청되면 information에 Url 키가 실린다. 없으면 전체 합계.
      const dim = typeof info.Url === 'string' ? info.Url.slice(0, 300) : '';
      // 지표별로 값 키가 달라서, 숫자로 읽히는 대표 키를 관용적으로 고른다.
      const v =
        num(info.totalSessionCount) ??
        num(info.sessionsCount) ??
        num(info.subTotal) ??
        num(info.pagesViews);
      if (v != null) rows.push({ source: 'clarity', day, metric: m.metricName, dim, value: v });
      const pct = num(info.sessionsWithMetricPercentage);
      if (pct != null)
        rows.push({ source: 'clarity', day, metric: `${m.metricName}_pct`, dim, value: pct });
    }
  }
  return { rows, raw: data };
}

// ---------- GA4 ----------

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function ga4AccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        iss: email,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  // Vercel env에는 개행이 \n 문자로 들어가므로 되돌린다
  const sig = b64url(signer.sign(privateKey.replace(/\\n/g, '\n')));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`ga4 token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function pullGa4(day: string): Promise<{ rows: Row[]; raw: unknown }> {
  const property = process.env.GA4_PROPERTY_ID;
  const email = process.env.GA4_CLIENT_EMAIL;
  const key = process.env.GA4_PRIVATE_KEY;
  if (!property || !email || !key) return { rows: [], raw: null };

  const token = await ga4AccessToken(email, key);
  const metrics = ['sessions', 'activeUsers', 'screenPageViews', 'engagementRate', 'averageSessionDuration'];
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: day, endDate: day }],
        metrics: metrics.map((name) => ({ name })),
        dimensions: [{ name: 'pagePath' }],
        limit: 50,
      }),
    }
  );
  if (!res.ok) throw new Error(`ga4 report ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
  };

  const rows: Row[] = [];
  const totals = new Map<string, number>();
  for (const r of data.rows ?? []) {
    const dim = r.dimensionValues[0]?.value?.slice(0, 300) ?? '';
    r.metricValues.forEach((mv, i) => {
      const v = Number(mv.value);
      if (!Number.isFinite(v)) return;
      rows.push({ source: 'ga4', day, metric: metrics[i], dim, value: v });
      // 합계: 비율·평균은 합산이 무의미하므로 count성 지표만
      if (i <= 2) totals.set(metrics[i], (totals.get(metrics[i]) ?? 0) + v);
    });
  }
  for (const [metric, value] of totals) rows.push({ source: 'ga4', day, metric, dim: '', value });
  return { rows, raw: data };
}

// ---------- handler ----------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  const day = kstYesterday();
  const client = db();
  const result: Record<string, unknown> = { day };

  for (const [name, pull] of [
    ['clarity', pullClarity],
    ['ga4', pullGa4],
  ] as const) {
    try {
      const { rows, raw } = await pull(day);
      if (raw != null) {
        await client.from('vl_external_raw').upsert({ source: name, day, payload: raw });
      }
      if (rows.length) {
        // 같은 (source,day,metric,dim) 키가 한 배치에 여러 번 오면 upsert가 충돌한다
        // (Clarity URL 분해는 정보 행이 키를 공유할 수 있다) — 합산해 1행으로.
        const merged = new Map<string, Row>();
        for (const r of rows) {
          const k = `${r.metric}|${r.dim}`;
          const ex = merged.get(k);
          if (ex) ex.value += r.value;
          else merged.set(k, { ...r });
        }
        const { error } = await client.from('vl_external_daily').upsert([...merged.values()]);
        if (error) throw error;
      }
      result[name] = rows.length ? `${rows.length} rows` : 'skipped (env 미설정)';
    } catch (e) {
      // 한 소스가 죽어도 다른 소스는 적재한다
      result[name] = `error: ${e instanceof Error ? e.message : JSON.stringify(e).slice(0, 300)}`;
    }
  }
  return NextResponse.json(result);
}
