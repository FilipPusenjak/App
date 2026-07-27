"use client";

import { useId, useState } from "react";

export type TrendPoint = { label: string; value: number | null };

/**
 * Single-series score trend.
 *
 * Design decisions worth keeping:
 * - One series per chart. Identity comes from the chart's own title, so no
 *   categorical palette is needed and no legend is required.
 * - The y-axis is the full 0-100 score range, never fitted to the data. Scores
 *   are bounded, and zooming the axis to the data would make a 3-point drift
 *   look like a transformation.
 * - Colour is a single validated hue (contrast >= 3:1 on both surfaces);
 *   all text uses text tokens, never the series colour.
 * - Hover gives a crosshair + readout; the surrounding page also lists every
 *   value as text, which is the non-visual path to the same data.
 */
export function ScoreTrend({
  points,
  compact = false,
  ariaLabel,
}: {
  points: TrendPoint[];
  compact?: boolean;
  ariaLabel: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  // The viewBox is sized near the element's real rendered width so text isn't
  // scaled down into illegibility — a compact panel renders around 380px wide,
  // so a 600-wide viewBox would shrink 10px labels to about 6px.
  const W = compact ? 340 : 600;
  const H = compact ? 140 : 200;
  const padL = compact ? 26 : 34;
  const padR = 10;
  const padT = 10;
  const padB = compact ? 14 : 26;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const x = (i: number) =>
    points.length <= 1
      ? padL + plotW / 2
      : padL + (i / (points.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / 100) * plotH;

  const filled = points
    .map((p, i) => ({ ...p, i }))
    .filter((p): p is { label: string; value: number; i: number } =>
      p.value != null,
    );

  const linePath = filled
    .map((p, k) => `${k === 0 ? "M" : "L"} ${x(p.i)} ${y(p.value)}`)
    .join(" ");

  const areaPath =
    filled.length > 1
      ? `${linePath} L ${x(filled[filled.length - 1]!.i)} ${padT + plotH} L ${x(filled[0]!.i)} ${padT + plotH} Z`
      : "";

  const gridValues = compact ? [0, 50, 100] : [0, 25, 50, 75, 100];
  const active = hover != null ? points[hover] : null;

  return (
    <div className="score-trend relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="trend-fill-top" />
            <stop offset="100%" className="trend-fill-bottom" />
          </linearGradient>
        </defs>

        {/* Recessive grid + axis labels */}
        {gridValues.map((g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(g)}
              y2={y(g)}
              className="trend-grid"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y(g) + 3}
              textAnchor="end"
              className="trend-axis-text"
              fontSize={10}
            >
              {g}
            </text>
          </g>
        ))}

        {areaPath && (
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        )}

        {linePath && (
          <path
            d={linePath}
            fill="none"
            className="trend-line"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Crosshair for the hovered point */}
        {active?.value != null && hover != null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padT}
            y2={padT + plotH}
            className="trend-crosshair"
            strokeWidth={1}
          />
        )}

        {/* Markers: 2px surface ring keeps them legible against the fill */}
        {filled.map((p) => (
          <circle
            key={p.i}
            cx={x(p.i)}
            cy={y(p.value)}
            r={hover === p.i ? 5 : 4}
            className="trend-marker"
            strokeWidth={2}
          />
        ))}

        {/* x labels: first and last only, so they never collide */}
        {!compact &&
          points.map((p, i) =>
            i === 0 || i === points.length - 1 ? (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? "start" : "end"}
                className="trend-axis-text"
                fontSize={10}
              >
                {p.label}
              </text>
            ) : null,
          )}

        {/* Generous invisible hit targets, wider than the markers */}
        {points.map((p, i) => (
          <rect
            key={`hit-${i}`}
            x={x(i) - plotW / Math.max(points.length, 2) / 2}
            y={padT}
            width={Math.max(plotW / Math.max(points.length, 1), 24)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && (
        <p className="mt-1 text-xs text-zinc-500" aria-live="polite">
          {active.label}:{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {active.value == null ? "not assessed" : `${active.value}/100`}
          </span>
        </p>
      )}
    </div>
  );
}
