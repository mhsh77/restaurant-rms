import { useLayoutEffect, useRef, useState } from 'react';

/** Track an element's width so SVG charts render crisply at any size. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceScale(maxValue, tickCount = 4) {
  if (maxValue <= 0) return { max: tickCount, step: 1 };
  const raw = maxValue / tickCount;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(maxValue / step) * step, step };
}

const roundedTop = (x, y, w, h, r) => `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;

/**
 * Single-series column chart. data: [{ key, label, short, value, extra }]
 * The time axis stays left-to-right (the convention for charts in Persian UIs too);
 * labels and the tooltip are Persian. Each column band is a hover/focus target.
 */
export function ColumnChart({ data, format, formatTick = format, height = 220, label }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { top: 12, right: 8, bottom: 28, left: 76 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const { max, step } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band * 0.7));
  const y = (v) => pad.top + innerH - (v / max) * innerH;
  const ticks = [];
  for (let v = 0; v <= max + step / 1000; v += step) ticks.push(v);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 48))));
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={ref} style={{ height }} dir="ltr">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-base' : 'chart-grid'} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.left + band * i + (band - barW) / 2;
            const top = y(d.value);
            const h = pad.top + innerH - top;
            return (
              <g key={d.key}>
                {h > 0.5 && <path d={roundedTop(x, top, barW, h, Math.min(4, barW / 2, h))} className={`chart-bar ${hover === i ? 'is-hover' : ''}`} />}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  className="chart-hit"
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
                {i % labelEvery === 0 && (
                  <text x={pad.left + band * i + band / 2} y={height - 9} textAnchor="middle" className="chart-tick">
                    {d.short ?? d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hovered && (
        <div
          className="chart-tip"
          dir="rtl"
          style={{
            left: Math.min(Math.max(pad.left + band * hover + band / 2, 80), width - 80),
            top: Math.max(0, y(hovered.value) - 8),
          }}
        >
          <strong>{format(hovered.value)}</strong>
          <span>{hovered.label}</span>
          {hovered.extra && <span>{hovered.extra}</span>}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars with the value at the tip. rows: [{ key, label, value, sub }] */
export function HBarList({ rows, format, emptyText = 'در این بازه داده‌ای وجود ندارد' }) {
  if (!rows.length) return <p className="muted pad">{emptyText}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.key} className="hbar">
          <span className="hbar-label">
            {r.label}
            {r.sub && <small className="muted"> {r.sub}</small>}
          </span>
          <span className="hbar-track" aria-hidden>
            <span className="hbar-fill" style={{ width: `${Math.max(0.5, (r.value / max) * 100)}%` }} />
          </span>
          <span className="hbar-value">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({ label, value, sub, hero = false }) {
  return (
    <div className={`stat ${hero ? 'stat-hero' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** Compact axis labels: ۱٫۵ میلیون، ۵۰۰ هزار. */
export function compactMoney(settings) {
  const d = settings?.currencyDecimals ?? 0;
  const nf = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 });
  return (minor) => nf.format(minor / 10 ** d);
}
