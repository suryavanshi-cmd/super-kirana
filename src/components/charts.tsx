'use client';
// Small dependency-free SVG charts for the shop owner's analysis screen.
import { rupeesShort } from '@/lib/store';

// Distinct, colour-blind-friendly palette (Okabe–Ito based) with a neutral grey for "others".
export const CHART_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9'];
export const OTHERS_COLOR = '#A3A3A3';

export interface Slice { label: string; value: number; color: string; sub?: string }

/** Donut (pie) chart with its legend: label, value and share of the whole. */
export function Donut({ slices, format, center, testId }: { slices: Slice[]; format: (v: number) => string; center?: string; testId?: string }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = 70, W = 26, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start" data-testid={testId}>
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={slices.map((s) => `${s.label} ${format(s.value)}`).join(', ')}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="#E5E7EB" strokeWidth={W} />
        {total > 0 && slices.map((s, i) => {
          const len = (Math.max(0, s.value) / total) * C;
          const el = (
            <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={s.color} strokeWidth={W}
              strokeDasharray={`${Math.max(len - (slices.length > 1 ? 1.5 : 0), 0)} ${C}`} strokeDashoffset={-offset}
              transform="rotate(-90 90 90)" />
          );
          offset += len;
          return el;
        })}
        {center && <text x="90" y="96" textAnchor="middle" className="fill-current text-[15px] font-bold">{center}</text>}
      </svg>
      <ul className="w-full min-w-0 space-y-2">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{s.label}</span>
              {s.sub && <span className="block truncate text-xs text-muted">{s.sub}</span>}
            </span>
            <span className="num shrink-0 text-right text-sm">
              <span className="block font-semibold">{format(s.value)}</span>
              <span className="block text-xs text-muted">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, longest first: easy to read on a phone. */
export function BarList({ rows, testId }: { rows: { label: string; value: number; display: string; sub?: string }[]; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3" data-testid={testId}>
      {rows.map((r, i) => (
        <li key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-semibold">{i + 1}. {r.label}{r.sub && <span className="ml-1 text-xs font-normal text-muted">{r.sub}</span>}</span>
            <span className="num shrink-0 font-semibold">{r.display}</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-slate-100">
            <div className="h-2.5 rounded-full bg-brand-600" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars for sales per day, with the best day labelled. */
export function DayBars({ days, label }: { days: { date: string; value: number }[]; label: (date: string) => string }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const best = days.reduce((b, d) => (d.value > b.value ? d : b), days[0] ?? { date: '', value: 0 });
  const H = 120, gap = days.length > 14 ? 2 : 6, w = Math.max(4, (300 - gap * (days.length - 1)) / Math.max(days.length, 1));
  return (
    <figure>
      <svg viewBox={`0 0 300 ${H + 22}`} className="h-44 w-full" role="img" aria-label={days.map((d) => `${label(d.date)} ${rupeesShort(d.value)}`).join(', ')}>
        <line x1="0" x2="300" y1={H} y2={H} stroke="#CBD5E1" />
        {days.map((d, i) => {
          const h = (d.value / max) * (H - 18);
          const x = i * (w + gap);
          const isBest = d.date === best.date && d.value > 0;
          return (
            <g key={d.date}>
              <rect x={x} y={H - h} width={w} height={Math.max(h, d.value > 0 ? 2 : 0)} rx="2" fill={isBest ? '#E69F00' : '#0072B2'} />
              {(days.length <= 7 || i === 0 || i === days.length - 1 || i % 7 === 0) && (
                <text x={x + w / 2} y={H + 15} textAnchor="middle" className="fill-slate-500 text-[10px]">{label(d.date)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {best.value > 0 && <figcaption className="text-center text-sm text-muted"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#E69F00]" aria-hidden="true" />{label(best.date)}: {rupeesShort(best.value)}</figcaption>}
    </figure>
  );
}
