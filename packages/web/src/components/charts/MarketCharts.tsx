import { useState } from 'react';
import type { Candle, TradeChart } from '../../api/types';
import { M, Tooltip, YAxis, useWidth } from './Charts';
import { linearScale, niceTicks } from './scale';

interface Level {
  label: string;
  value: number;
  color: string;
}

/**
 * Daily candlesticks with the trade's holding window shaded, fill markers
 * (▲ buy under the low, ▼ sell over the high) and labelled horizontal levels.
 */
export function CandlestickChart({
  chart,
  formatPrice,
  height = 320,
}: {
  chart: TradeChart;
  formatPrice: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const bars = chart.candles;
  if (bars.length === 0) return <div className="empty">No price data yet.</div>;

  const lv = chart.levels;
  const levels: Level[] = [
    ...(lv.initialStop !== null
      ? [{ label: 'Initial stop', value: lv.initialStop, color: 'var(--chart-neg)' }]
      : []),
    ...(lv.currentStop !== null && lv.currentStop !== lv.initialStop
      ? [{ label: 'Current stop', value: lv.currentStop, color: 'var(--chart-neg-deep)' }]
      : []),
    ...(lv.target !== null
      ? [{ label: 'Target', value: lv.target, color: 'var(--chart-series)' }]
      : []),
    ...(lv.avgEntry !== null
      ? [{ label: 'Avg entry', value: lv.avgEntry, color: 'var(--chart-muted)' }]
      : []),
  ];
  const lo = Math.min(...bars.map((b) => b.low), ...levels.map((l) => l.value));
  const hi = Math.max(...bars.map((b) => b.high), ...levels.map((l) => l.value));
  const ticks = niceTicks(lo, hi, 5);
  const right = 96; // room for level labels
  const y = linearScale([ticks[0] ?? lo, ticks.at(-1) ?? hi], [height - M.bottom, M.top]);
  const plotW = Math.max(1, width - M.left - right);
  const slot = plotW / bars.length;
  const cx = (i: number) => M.left + (i + 0.5) * slot;
  const bodyW = Math.max(1, Math.min(10, slot * 0.6));
  const index = new Map(bars.map((b, i) => [b.date, i]));
  const entry = index.get(chart.markers.find((m) => m.side === 'BUY')?.date ?? '');
  const exitDates = chart.markers.filter((m) => m.side === 'SELL').map((m) => m.date);
  // Open trades are shaded up to the latest bar, closed ones up to the final sell.
  const exit =
    chart.status === 'OPEN' || exitDates.length === 0
      ? bars.length - 1
      : index.get(exitDates.at(-1) ?? '');
  // Level labels: keep at least 12px apart so close lines (e.g. stop vs entry) stay readable.
  const labelY = new Map<string, number>();
  [...levels]
    .sort((a, b) => y(a.value) - y(b.value))
    .reduce((prev, l) => {
      const ly = Math.max(y(l.value), prev + 12);
      labelY.set(l.label, ly);
      return ly;
    }, Number.NEGATIVE_INFINITY);
  const hb: Candle | null = hover === null ? null : (bars[hover] ?? null);
  const step = Math.ceil(bars.length / 6);

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Daily price chart of ${chart.symbol}`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - box.left - M.left) / slot);
            setHover(i >= 0 && i < bars.length ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {entry !== undefined && exit !== undefined && (
            <rect
              x={M.left + entry * slot}
              y={M.top}
              width={(exit - entry + 1) * slot}
              height={height - M.top - M.bottom}
              fill="var(--surface-2)"
            />
          )}
          <YAxis ticks={ticks} y={y} width={width - right + M.right} format={formatPrice} />
          {levels.map((l) => (
            <g key={l.label}>
              <line
                x1={M.left}
                x2={M.left + plotW}
                y1={y(l.value)}
                y2={y(l.value)}
                stroke={l.color}
                strokeWidth={1.5}
              />
              <text
                className="tick"
                x={M.left + plotW + 6}
                y={labelY.get(l.label) ?? y(l.value)}
                dy="0.32em"
                style={{ fill: 'var(--chart-ink-2)' }}
              >
                {l.label}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const up = b.close >= b.open;
            const color = up ? 'var(--chart-series)' : 'var(--chart-neg)';
            const top = y(Math.max(b.open, b.close));
            const bottom = y(Math.min(b.open, b.close));
            return (
              <g key={b.date} opacity={hover === null || hover === i ? 1 : 0.6}>
                <line
                  x1={cx(i)}
                  x2={cx(i)}
                  y1={y(b.high)}
                  y2={y(b.low)}
                  stroke={color}
                  strokeWidth={1}
                />
                <rect
                  x={cx(i) - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={Math.max(1, bottom - top)}
                  fill={color}
                  rx={1}
                />
                {i % step === 0 && (
                  <text className="tick" x={cx(i)} y={height - 6} textAnchor="middle">
                    {b.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
          {chart.markers.map((m, k) => {
            const i = index.get(m.date);
            const b = i === undefined ? undefined : bars[i];
            if (i === undefined || !b) return null;
            const buy = m.side === 'BUY';
            const yy = buy ? y(b.low) + 12 : y(b.high) - 12;
            const d = buy ? `M${cx(i)},${yy - 6}l5,9h-10z` : `M${cx(i)},${yy + 6}l5,-9h-10z`;
            return (
              <path
                key={k}
                d={d}
                fill="var(--chart-ink)"
                stroke="var(--chart-surface)"
                strokeWidth={2}
              >
                <title>
                  {buy ? 'Buy' : 'Sell'} at {formatPrice(m.price)} on {m.date}
                </title>
              </path>
            );
          })}
          {hover !== null && (
            <line
              x1={cx(hover)}
              x2={cx(hover)}
              y1={M.top}
              y2={height - M.bottom}
              stroke="var(--chart-axis)"
            />
          )}
        </svg>
      )}
      {hb && hover !== null && (
        <Tooltip x={cx(hover)} y={y(hb.high)}>
          <strong>{formatPrice(hb.close)}</strong>
          <span>
            {hb.date} · O {formatPrice(hb.open)} H {formatPrice(hb.high)} L {formatPrice(hb.low)}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
}

/** Several series on one shared y-scale (e.g. indexed to 100), with legend and end labels. */
export function MultiLineChart({
  dates,
  series,
  format,
  height = 240,
  label,
}: {
  dates: string[];
  series: LineSeries[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (dates.length === 0 || all.length === 0)
    return <div className="empty">No data for this filter.</div>;
  const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
  const right = 70;
  const y = linearScale([ticks[0] ?? 0, ticks.at(-1) ?? 1], [height - M.bottom, M.top]);
  const n = dates.length;
  const x = linearScale([0, Math.max(1, n - 1)], [M.left, Math.max(M.left + 1, width - right)]);
  const path = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .reduce<string>(
        (d, p, i, arr) => (p === null ? d : `${d}${arr[i - 1] == null ? 'M' : 'L'}${p}`),
        '',
      );

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 4 }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 2, background: s.color, display: 'inline-block' }} />
            {s.name}
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.round(
              ((e.clientX - box.left - M.left) / (width - M.left - right)) * (n - 1),
            );
            setHover(Math.max(0, Math.min(n - 1, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <YAxis ticks={ticks} y={y} width={width - right + M.right} format={format} />
          {series.map((s) => {
            const lastIdx = s.values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
            const last = s.values[lastIdx];
            return (
              <g key={s.name}>
                <path
                  d={path(s.values)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {last != null && (
                  <text
                    className="tick"
                    x={x(lastIdx) + 6}
                    y={y(last)}
                    dy="0.32em"
                    style={{ fill: 'var(--chart-ink-2)' }}
                  >
                    {s.name}
                  </text>
                )}
              </g>
            );
          })}
          {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
            <text
              key={i}
              className="tick"
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {dates[i]}
            </text>
          ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={M.top}
              y2={height - M.bottom}
              stroke="var(--chart-axis)"
            />
          )}
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={x(hover)} y={M.top + 30}>
          {series.map((s) => (
            <span key={s.name} style={{ display: 'block' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 2,
                  background: s.color,
                  marginRight: 6,
                  verticalAlign: 'middle',
                }}
              />
              <strong style={{ display: 'inline' }}>
                {s.values[hover] == null ? '—' : format(s.values[hover] as number)}
              </strong>{' '}
              {s.name}
            </span>
          ))}
          <span>{dates[hover]}</span>
        </Tooltip>
      )}
    </div>
  );
}
