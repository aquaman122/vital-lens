import { onLCP, onINP, onCLS, onTTFB, onFCP, type Metric } from 'web-vitals';

export interface VitalLensConfig {
  /** Supabase project URL, e.g. https://xxxx.supabase.co */
  endpoint: string;
  /** Supabase publishable (anon) key — insert 권한 없음, RPC 실행만 가능 */
  apiKey: string;
  /** sites 테이블에 등록한 site id */
  site: string;
  /** 배포 식별자 (예: 커밋 SHA, 빌드 번호). 미지정 시 'unknown' */
  release?: string;
  /** 0~1 샘플링 비율. 기본 1 (전부 수집) */
  sampleRate?: number;
  /** true면 콘솔에 전송 내용 출력 */
  debug?: boolean;
}

type Ev = {
  type: 'metric' | 'error' | 'pageview';
  name: string;
  value?: number;
  rating?: string;
  path: string;
  release: string;
  device: string;
  conn?: string;
  sid: string;
  detail?: {
    // error
    message?: string;
    stack?: string;
    source?: string;
    // INP attribution
    target?: string;
    interaction?: string;
    input_delay?: number;
    processing?: number;
    presentation?: number;
  };
};

const MAX_BATCH = 50;
const FLUSH_MS = 10_000;

function deviceType(): string {
  const w = window.innerWidth;
  if (/Mobi|Android/i.test(navigator.userAgent)) return w >= 768 ? 'tablet' : 'mobile';
  return 'desktop';
}

/** INP attribution용 CSS 셀렉터 — id에서 끊고, 최대 4단계. */
function selector(el: unknown): string | undefined {
  const parts: string[] = [];
  let n = el as Element | null;
  while (n && n.nodeType === 1 && parts.length < 4) {
    let s = n.nodeName.toLowerCase();
    if (n.id) {
      parts.unshift(`${s}#${n.id}`);
      break;
    }
    const c = typeof n.className === 'string' && n.className.trim().split(/\s+/)[0];
    if (c) s += `.${c}`;
    parts.unshift(s);
    n = n.parentElement;
  }
  return parts.length ? parts.join('>') : undefined;
}

function connType(): string | undefined {
  const c = (navigator as any).connection;
  return c?.effectiveType;
}

function sessionId(): string {
  try {
    const k = '_vl_sid';
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID();
      sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

export function init(cfg: VitalLensConfig): void {
  if (typeof window === 'undefined') return;
  const rate = cfg.sampleRate ?? 1;
  if (Math.random() >= rate) return;

  const url = `${cfg.endpoint.replace(/\/$/, '')}/rest/v1/rpc/vl_ingest`;
  const sid = sessionId();
  const base = () => ({
    path: location.pathname,
    release: cfg.release ?? 'unknown',
    device: deviceType(),
    conn: connType(),
    sid,
  });

  let buf: Ev[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(useBeacon = false): void {
    if (!buf.length) return;
    const events = buf.splice(0, MAX_BATCH);
    const body = JSON.stringify({ batch: { site: cfg.site, events } });
    if (cfg.debug) console.log('[vital-lens] flush', events);

    if (useBeacon && navigator.sendBeacon) {
      // sendBeacon은 헤더를 못 실으므로 apikey를 쿼리로 전달
      const ok = navigator.sendBeacon(
        `${url}?apikey=${encodeURIComponent(cfg.apiKey)}`,
        new Blob([body], { type: 'application/json' })
      );
      if (ok) return;
    }
    fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
      body,
    }).catch(() => {
      /* 수집 실패는 앱에 영향 주지 않는다 */
    });
  }

  function push(ev: Ev): void {
    buf.push(ev);
    if (buf.length >= MAX_BATCH) flush();
    else if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, FLUSH_MS);
    }
  }

  // Core Web Vitals — 각 메트릭은 페이지 수명 중 확정될 때 보고됨
  const onMetric = (m: Metric) => {
    const ev: Ev = { type: 'metric', name: m.name, value: m.value, rating: m.rating, ...base() };
    // INP attribution: web-vitals/attribution 빌드는 gzip 예산(4KB)을 넘겨서 못 쓴다.
    // 같은 정보가 metric.entries(PerformanceEventTiming)에 있으므로 직접 계산한다.
    const e = m.name === 'INP' ? (m.entries?.[0] as PerformanceEventTiming | undefined) : undefined;
    if (e) {
      ev.detail = {
        target: selector((e as PerformanceEventTiming & { target?: unknown }).target),
        interaction: e.name,
        input_delay: Math.round(e.processingStart - e.startTime),
        processing: Math.round(e.processingEnd - e.processingStart),
        // duration은 startTime 기준 전체 폭 — 남는 구간이 렌더/페인트 지연
        presentation: Math.round(Math.max(0, e.startTime + e.duration - e.processingEnd)),
      };
    }
    push(ev);
  };
  onLCP(onMetric);
  onINP(onMetric);
  onCLS(onMetric);
  onTTFB(onMetric);
  onFCP(onMetric);

  // JS 에러
  window.addEventListener('error', (e) => {
    push({
      type: 'error',
      name: e.error?.name ?? 'Error',
      ...base(),
      detail: {
        message: String(e.message ?? '').slice(0, 500),
        stack: String(e.error?.stack ?? '').slice(0, 2000),
        source: `${e.filename ?? ''}:${e.lineno ?? 0}`,
      },
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e.reason;
    push({
      type: 'error',
      name: r?.name ?? 'UnhandledRejection',
      ...base(),
      detail: {
        message: String(r?.message ?? r ?? '').slice(0, 500),
        stack: String(r?.stack ?? '').slice(0, 2000),
      },
    });
  });

  push({ type: 'pageview', name: 'pageview', ...base() });

  // 페이지 이탈 시 남은 버퍼를 beacon으로
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  addEventListener('pagehide', () => flush(true));
}

// <script> 태그 data-* 속성만으로도 초기화 가능
const s =
  typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
if (s?.dataset.endpoint && s.dataset.key && s.dataset.site) {
  init({
    endpoint: s.dataset.endpoint,
    apiKey: s.dataset.key,
    site: s.dataset.site,
    release: s.dataset.release,
    sampleRate: s.dataset.sample ? Number(s.dataset.sample) : undefined,
    debug: 'debug' in s.dataset,
  });
}
