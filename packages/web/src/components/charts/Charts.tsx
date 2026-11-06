/**
 * Small SVG chart kit following the dataviz skill: one y-axis, recessive hairline grid,
 * 2px lines, ≥8px dots with larger hit targets, rounded bar ends on the baseline,
 * crosshair tooltip on lines, per-mark tooltip on bars/dots/cells. Every chart is
 * paired with a data table by its caller, so tooltips never gate a value.
 */
import type { Bin } from '@tj/core';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { divergingFill, linearScale, niceTicks } from './scale';

const M = { top: 10, right: 12, bottom: 26, left: 64 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="chart-tooltip" style={{ left: x, top: y }} role="presentation">
      {children}
    </div>
  );
}

function YAxis({
  ticks,
  y,
  width,
  format,
}: {
  ticks: number[];
  y: (v: number) => number;
  width: number;
  format: (v: number) => string;
}) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={M.left}
            x2={width - M.right}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <text className="tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------

export interface SeriesPoint {
  x: string;
  y: number;
}

/**
 * Single-series line over evenly spaced points (trading days or trade sequence).
 * `area="toZero"` fills between the line and 0 (underwater/drawdown charts).
 */
export function LineChart({
  points,
  format,
  tooltipFormat = format,
  xLabel = (x) => x,
  color = 'var(--chart-series)',
  area,
  includeZero = false,
  height = 220,
  label,
}: {
  points: SeriesPoint[];
  /** Axis ticks. */
  format: (v: number) => string;
  /** The value shown in the hover tooltip (defaults to `format`). */
  tooltipFormat?: (v: number) => string;
  xLabel?: (x: string) => string;
  color?: string;
  area?: 'toZero';
  includeZero?: boolean;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <div className="empty">No data for this filter.</div>;

  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys, ...(includeZero || area ? [0] : []));
  const hi = Math.max(...ys, ...(includeZero || area ? [0] : []));
  const ticks = niceTicks(lo, hi, 4);
  const y = linearScale([ticks[0] ?? lo, ticks.at(-1) ?? hi], [height - M.bottom, M.top]);
  const n = points.length;
  const x = linearScale([0, Math.max(1, n - 1)], [M.left, Math.max(M.left + 1, width - M.right)]);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`)
    .join('');
  const fill = area ? `${path}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : null;
  const xTicks = n <= 1 ? [0] : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1)));
  const h = hover === null ? null : points[hover];

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.round(
              ((e.clientX - box.left - M.left) / (width - M.left - M.right)) * (n - 1),
            );
            setHover(Math.max(0, Math.min(n - 1, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <YAxis ticks={ticks} y={y} width={width} format={format} />
          {lo < 0 && hi > 0 && (
            <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" />
          )}
          {fill && <path d={fill} fill={color} opacity={0.18} />}
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          {xTicks.map((i) => (
            <text
              key={i}
              className="tick"
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {xLabel(points[i]?.x ?? '')}
            </text>
          ))}
          {h && hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={M.top}
                y2={height - M.bottom}
                stroke="var(--chart-axis)"
              />
              <circle
                cx={x(hover)}
                cy={y(h.y)}
                r={4}
                fill={color}
                stroke="var(--chart-surface)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <Tooltip x={x(hover)} y={y(h.y)}>
          <strong>{tooltipFormat(h.y)}</strong>
          <span>{xLabel(h.x)}</span>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Histogram with polarity colouring: bins below 0 red, at/above 0 blue. */
export function Histogram({
  bins,
  binLabel,
  height = 200,
  label,
}: {
  bins: Bin[];
  binLabel: (b: Bin) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (bins.length === 0) return <div className="empty">No data for this filter.</div>;

  const max = Math.max(...bins.map((b) => b.count));
  const ticks = niceTicks(0, Math.max(1, max), 4).filter((t) => Number.isInteger(t));
  const y = linearScale([0, ticks.at(-1) ?? max], [height - M.bottom, M.top]);
  const slot = (width - M.left - M.right) / bins.length;
  const barW = Math.max(1, slot - 2); // 2px surface gap
  const r = Math.min(4, barW / 2);
  const every = Math.ceil(bins.length / 8);
  const hb = hover === null ? null : bins[hover];

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onPointerLeave={() => setHover(null)}
        >
          <YAxis ticks={ticks} y={y} width={width} format={(v) => String(v)} />
          {bins.map((b, i) => {
            const x0 = M.left + i * slot + 1;
            const top = y(b.count);
            const base = y(0);
            const h = base - top;
            const color = b.to <= 0 ? 'var(--chart-neg)' : 'var(--chart-series)';
            return (
              <g key={b.from} onPointerEnter={() => setHover(i)}>
                <rect
                  x={M.left + i * slot}
                  y={M.top}
                  width={slot}
                  height={base - M.top}
                  fill="transparent"
                />
                {b.count > 0 && (
                  <path
                    d={`M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${base}Z`}
                    fill={color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {h >= 0 && i % every === 0 && (
                  <text className="tick" x={x0} y={height - 6}>
                    {binLabel(b).split(' to ')[0]}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" />
        </svg>
      )}
      {hb && hover !== null && (
        <Tooltip x={M.left + (hover + 0.5) * slot} y={y(hb.count)}>
          <strong>
            {hb.count} {hb.count === 1 ? 'trade' : 'trades'}
          </strong>
          <span>{binLabel(hb)}</span>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface ScatterPoint {
  id: number;
  x: number;
  y: number;
  label: string;
}

/** Scatter of trades; each dot is a link (click / Enter) with a generous hit target. */
export function Scatter({
  points,
  xFormat,
  yFormat,
  xTitle,
  onOpen,
  height = 240,
  label,
}: {
  points: ScatterPoint[];
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  xTitle: string;
  onOpen: (id: number) => void;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  if (points.length === 0) return <div className="empty">No data for this filter.</div>;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xt = niceTicks(Math.min(0, ...xs), Math.max(...xs, 1), 5);
  const yt = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys), 4);
  const x = linearScale([xt[0] ?? 0, xt.at(-1) ?? 1], [M.left, width - M.right]);
  const y = linearScale([yt[0] ?? 0, yt.at(-1) ?? 1], [height - M.bottom - 14, M.top]);

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <YAxis ticks={yt} y={y} width={width} format={yFormat} />
          <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" />
          {xt.map((t) => (
            <text key={t} className="tick" x={x(t)} y={height - 22} textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
          <text
            className="tick"
            x={(M.left + width - M.right) / 2}
            y={height - 4}
            textAnchor="middle"
          >
            {xTitle}
          </text>
          {points.map((p) => (
            <g
              key={p.id}
              role="link"
              tabIndex={0}
              aria-label={p.label}
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => setHover(p)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}
            >
              <circle cx={x(p.x)} cy={y(p.y)} r={12} fill="transparent" />
              <circle
                cx={x(p.x)}
                cy={y(p.y)}
                r={4}
                fill={p.y < 0 ? 'var(--chart-neg)' : 'var(--chart-series)'}
                stroke="var(--chart-surface)"
                strokeWidth={2}
                opacity={hover && hover.id !== p.id ? 0.5 : 1}
              />
            </g>
          ))}
        </svg>
      )}
      {hover && (
        <Tooltip x={x(hover.x)} y={y(hover.y)}>
          <strong>{yFormat(hover.y)}</strong>
          <span>{hover.label}</span>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Year × month grid of net P&L (diverging fill) and trade count; cells are buttons. */
export function MonthHeatmap({
  cells,
  formatMoney,
  formatCompact,
  onOpen,
}: {
  cells: { month: string; netPnl: number; count: number }[];
  formatMoney: (v: number) => string;
  formatCompact: (v: number) => string;
  onOpen: (month: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (cells.length === 0) return <div className="empty">No closed trades for this filter.</div>;
  const byMonth = new Map(cells.map((c) => [c.month, c]));
  const years = [...new Set(cells.map((c) => c.month.slice(0, 4)))].sort();
  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.netPnl)));
  return (
    <div className="heatmap" role="grid" aria-label="Monthly net P&L">
      <span />
      {MONTHS.map((m) => (
        <span key={m} className="head">
          {m}
        </span>
      ))}
      {years.map((year) => (
        <div key={year} style={{ display: 'contents' }} role="row">
          <span className="year">{year}</span>
          {MONTHS.map((m, i) => {
            const key = `${year}-${String(i + 1).padStart(2, '0')}`;
            const c = byMonth.get(key);
            if (!c) return <span key={key} className="empty-cell" aria-hidden />;
            const { background, ink } = divergingFill(c.netPnl, maxAbs);
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                style={{
                  background,
                  color: ink,
                  outline: hover === key ? '2px solid var(--chart-axis)' : undefined,
                }}
                aria-label={`${m} ${year}: ${formatMoney(c.netPnl)}, ${c.count} ${c.count === 1 ? 'trade' : 'trades'}. Show trades`}
                title={`${m} ${year}: ${formatMoney(c.netPnl)} · ${c.count} trades`}
                onPointerEnter={() => setHover(key)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onOpen(key)}
              >
                <strong>{formatCompact(c.netPnl)}</strong>
                <br />
                {c.count} tr
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
