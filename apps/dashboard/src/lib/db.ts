import 'server-only';
import { createClient } from '@supabase/supabase-js';

// 서버 전용 클라이언트. secret key는 RLS를 우회하므로 절대 클라이언트로 내리지 않는다.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수를 설정하세요 (.env.example 참고)');
  return createClient(url, key, { auth: { persistSession: false } });
}

export type DailyMetric = {
  site_id: string;
  day: string;
  name: string;
  device: string;
  samples: number;
  p75: number | null;
  p95: number | null;
};

export type ReleaseMetric = {
  site_id: string;
  release: string;
  name: string;
  samples: number;
  first_seen: string;
  last_seen: string;
  p75: number | null;
};

export type PageMetric = {
  site_id: string;
  path: string;
  name: string;
  samples: number;
  p75: number | null;
};

export type RecentError = {
  site_id: string;
  ts: string;
  name: string;
  path: string;
  release: string;
  device: string;
  message: string | null;
  source: string | null;
};

const DAYS = 28;

export async function fetchSites() {
  const { data, error } = await db().from('sites').select('id, name, created_at').order('created_at');
  if (error) throw error;
  return data;
}

export async function fetchDaily(siteId: string): Promise<DailyMetric[]> {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  const { data, error } = await db()
    .from('vl_daily_metrics')
    .select('*')
    .eq('site_id', siteId)
    .gte('day', since)
    .order('day');
  if (error) throw error;
  return data as DailyMetric[];
}

export async function fetchReleases(siteId: string): Promise<ReleaseMetric[]> {
  const { data, error } = await db()
    .from('vl_release_metrics')
    .select('*')
    .eq('site_id', siteId)
    .order('last_seen', { ascending: false })
    .limit(40);
  if (error) throw error;
  return data as ReleaseMetric[];
}

export async function fetchPages(siteId: string): Promise<PageMetric[]> {
  const { data, error } = await db()
    .from('vl_page_metrics')
    .select('*')
    .eq('site_id', siteId)
    .eq('name', 'LCP')
    .order('p75', { ascending: false })
    .limit(15);
  if (error) throw error;
  return data as PageMetric[];
}

export async function fetchErrors(siteId: string): Promise<RecentError[]> {
  const { data, error } = await db()
    .from('vl_recent_errors')
    .select('*')
    .eq('site_id', siteId)
    .limit(30);
  if (error) throw error;
  return data as RecentError[];
}
