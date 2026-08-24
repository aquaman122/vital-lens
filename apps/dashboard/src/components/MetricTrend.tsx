'use client';
import { useState } from 'react';

export type Point = { day: string; p75: number; samples: number };

const W = 300;
const H = 96;
const PAD = { l: 8, r: 8, t: 10, b: 18 };

/** 단일 시리즈 일별 p75 추이 — 시리즈가 하나이므로 범례 없이 타이틀이 시리즈명을 겸한다.
 *  호버 크로스헤어 + 툴팁 (dataviz 규칙: line 차트 기본 인터랙션). */
export default function MetricTrend({
  title,
  unit,
  points,
  goodMax,
  poorMin,
  format,
}: {
  title: string;
  unit: string;
  points: Point[];
  goodMax: number;
  poorMin: number;
  format: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!points.length) {
    return (
      <div className="card">
        <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{title}</div>
        <p style={{ color: 'var(--text-muted)', margin: '20px 0' }}>아직 데이터가 없습니다</p>
      </div>
    );
  }

  const vals = points.map((p) => p.p75);
  const max = Math.max(...vals, poorMin) * 1.1;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p75).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  const rating = last.p75 <= goodMax ? 'good' : last.p75 <= poorMin ? 'needs-improvement' : 'poor';
  const ratingLabel = { good: '좋음', 'needs-improvement': '개선 필요', poor: '나쁨' }[rating];
  const ratingColor = {
    good: 'var(--status-good)',
    'needs-improvement': 'var(--status-warning)',
    poor: 'var(--status-critical)',
  }[rating];
  const hp = hover === null ? null : points[hover];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{title}</span>
        <span className="badge">
          <span className="dot" style={{ background: ratingColor }} />
          {ratingLabel}
        </span>
      </div>
      <div className="hero" style={{ margin: '2px 0 6px' }}>
        {format(last.p75)}
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
          {unit} · p75
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title} 최근 ${points.length}일 p75 추이`}
          style={{ width: '100%', display: 'block' }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            let best = 0;
            for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
            setHover(best);
          }}
        >
          {/* 임계 기준선 (good 경계) */}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(goodMax)} y2={y(goodMax)} stroke="var(--grid)" strokeDasharray="3 3" />
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--axis)" />
          <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <g>
              <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--axis)" />
              <circle cx={x(hover!)} cy={y(hp.p75)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )}
          <text x={PAD.l} y={H - 4} fill="var(--text-muted)" fontSize={10}>
            {points[0].day.slice(5)}
          </text>
          <text x={W - PAD.r} y={H - 4} fill="var(--text-muted)" fontSize={10} textAnchor="end">
            {last.day.slice(5)}
          </text>
        </svg>
        {hp && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${(x(hover!) / W) * 100}%`,
              transform: `translateX(${hover! > points.length / 2 ? '-105%' : '8px'})`,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>{hp.day.slice(5)}</span>{' '}
            <strong>{format(hp.p75)}{unit}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>n={hp.samples}</span>
          </div>
        )}
      </div>
    </div>
  );
}
