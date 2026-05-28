import { useMemo, useState } from 'react';
import type { RoundRecord } from '@/types';

type ChartType = 'bar' | 'scatter' | 'line' | 'heatmap';
type SeriesStyle = 'solid' | 'dashed' | 'dotted';
type SeriesAxis = 'left' | 'right';

type MetricKey =
  | 'cvr'
  | 'cci'
  | 'cpd'
  | 'tc'
  | 'tl'
  | 'lc'
  | 'meaning'
  | 'reactionDelay'
  | 'responseCoeff'
  | 'repeatCoeff';

type AxisKey = MetricKey | 'round' | 'cvrBand';

interface ChartSeries {
  id: string;
  metric: MetricKey;
  label?: string;
  color?: string;
  unit?: string;
  renderAs?: 'line' | 'bar' | 'dot' | 'area';
  style?: SeriesStyle;
  width?: number;
  axis?: SeriesAxis;
  enabledByDefault?: boolean;
}

interface ChartNote {
  id: string;
  title: string;
  body: string;
  seriesId?: string;
  color?: string;
}

interface ChartReadingGuide {
  title?: string;
  summary?: string;
  notes: ChartNote[];
}

interface ChartPreset {
  id: string;
  label: string;
  chartType: ChartType;
  xAxis: AxisKey;
  series: ChartSeries[];
  description: string;
  role: 'captain' | 'crew' | 'all';
  allowSeriesToggle?: boolean;
  allowAxisSwap?: boolean;
  yScaleMode?: 'shared' | 'dual';
  readingGuide?: ChartReadingGuide;
}

interface RoleRound {
  round: RoundRecord;
  role: 'captain' | 'crew';
}

interface FlexibleChartProps {
  roleRounds: RoleRound[];
  presets: ChartPreset[];
  defaultPresetId?: string;
  crewWinThreshold: number;
}

const CVR_BANDS = [
  { label: '0–15Ω', tag: 'Dễ', min: 0, max: 15 },
  { label: '15–35Ω', tag: 'Vừa', min: 15, max: 35 },
  { label: '35–60Ω', tag: 'Khó', min: 35, max: 60 },
  { label: '60Ω+', tag: 'Extreme', min: 60, max: Infinity },
];

const METRIC_META: Record<MetricKey, { label: string; unit: string; color: string }> = {
  cvr: { label: 'CVR', unit: 'Ω', color: 'var(--red, #ef4444)' },
  cci: { label: 'CCI', unit: 'A', color: '#10b981' },
  cpd: { label: 'CPD', unit: 'V', color: 'var(--blue, #3b82f6)' },
  tc: { label: 'TC', unit: '', color: '#f59e0b' },
  tl: { label: 'TL', unit: '', color: '#8b5cf6' },
  lc: { label: 'LC', unit: '', color: '#ec4899' },
  meaning: { label: 'Semantics', unit: '%', color: '#10b981' },
  reactionDelay: { label: 'Reaction', unit: 'ms', color: '#6b7280' },
  responseCoeff: { label: 'Response Coeff', unit: '', color: '#14b8a6' },
  repeatCoeff: { label: 'Repeat Coeff', unit: '', color: '#a855f7' },
};

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'line', label: 'Line' },
  { value: 'heatmap', label: 'Heatmap' },
];

const ALL_AXES: { value: AxisKey; label: string }[] = [
  { value: 'round', label: 'Round (time)' },
  { value: 'cvrBand', label: 'CVR Band' },
  { value: 'cvr', label: 'CVR (Ω)' },
  { value: 'cci', label: 'CCI (A)' },
  { value: 'cpd', label: 'CPD (V)' },
  { value: 'tc', label: 'TC' },
  { value: 'tl', label: 'TL' },
  { value: 'lc', label: 'LC' },
  { value: 'meaning', label: 'Semantics %' },
  { value: 'reactionDelay', label: 'Reaction delay' },
  { value: 'responseCoeff', label: 'Response Coeff' },
  { value: 'repeatCoeff', label: 'Repeat Coeff' },
];

function extractMetric(round: RoundRecord, key: MetricKey): number | null {
  const n = (v: unknown) => {
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
  switch (key) {
    case 'cvr': return n(round.metrics?.cvr.rawUnits ?? round.ohmResult?.totalOhm);
    case 'cci': return n(round.metrics?.cci.current ?? (n(round.evaluation?.matchScore) ?? 0) / 100);
    case 'cpd': return n(round.metrics?.cpd.raw ?? round.metrics?.cpd.score);
    case 'tc': return n(round.metrics?.cvr.estimatedTC ?? round.ohmResult?.estimatedTC);
    case 'tl': return n(round.metrics?.cvr.tensionLoad ?? round.ohmResult?.tensionLoad);
    case 'lc': return n(round.metrics?.cvr.linguisticComplexity ?? round.ohmResult?.linguisticComplexity);
    case 'meaning': return n(round.metrics?.cci.llmMeaningPercent ?? round.evaluation?.matchScore);
    case 'reactionDelay': return n(round.reactionDelayMs);
    case 'responseCoeff': return n(round.metrics?.cvr.responseCoefficient ?? round.ohmResult?.responseCoefficient);
    case 'repeatCoeff': return n(round.metrics?.cvr.repeatCoefficient ?? round.ohmResult?.repeatCoefficient);
  }
}

function fmt(v: number | null, digits = 1, suffix = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

function normalizeSeries(series: ChartSeries) {
  const meta = METRIC_META[series.metric];
  return {
    ...series,
    label: series.label || meta.label,
    unit: series.unit ?? meta.unit,
    color: series.color || meta.color,
    renderAs: series.renderAs || 'line',
    style: series.style || 'solid',
    width: series.width ?? (series.metric === 'cpd' ? 4 : 3),
    axis: series.axis || 'left',
  };
}

function makeOverrideSeries(metric: MetricKey): ChartSeries {
  const meta = METRIC_META[metric];
  return {
    id: metric,
    metric,
    label: meta.label,
    unit: meta.unit,
    color: meta.color,
    renderAs: 'line',
    style: 'solid',
    width: metric === 'cpd' ? 4 : 3,
    axis: 'left',
    enabledByDefault: true,
  };
}

function lineDash(style: SeriesStyle) {
  if (style === 'dashed') return '8 6';
  if (style === 'dotted') return '2 6';
  return undefined;
}

const W = 460;
const H = 220;
const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function BarChart({ data, primarySeries }: {
  data: { x: string; values: Record<string, number>; passRate?: number }[];
  primarySeries: ReturnType<typeof normalizeSeries>;
}) {
  const maxVal = Math.max(1, ...data.map((d) => d.values[primarySeries.id] || 0));
  const barW = Math.min(48, PLOT_W / Math.max(1, data.length) - 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profile-chart-svg">
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="profile-axis" />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="profile-axis" />
      {data.map((d, i) => {
        const cx = PAD.left + (i + 0.5) * (PLOT_W / data.length);
        const primaryVal = d.values[primarySeries.id] || 0;
        const h = (primaryVal / maxVal) * PLOT_H;
        const y = H - PAD.bottom - h;
        const passH = d.passRate != null ? h * (d.passRate / 100) : 0;
        return (
          <g key={i} className="profile-bar-group" style={{ cursor: 'pointer' }}>
            <title>{`${d.x}: ${primarySeries.label}=${fmt(primaryVal, 1, primarySeries.unit)}${d.passRate != null ? ` | pass ${d.passRate.toFixed(0)}%` : ''}`}</title>
            <rect x={cx - barW / 2} y={y} width={barW} height={h} rx={6} style={{ fill: primarySeries.color, opacity: 0.7 }} />
            {passH > 0 && (
              <rect x={cx - barW / 2} y={H - PAD.bottom - passH} width={barW} height={passH} rx={6} className="profile-bar-green" style={{ opacity: 0.85 }} />
            )}
            <text x={cx} y={H - PAD.bottom + 18} textAnchor="middle" fontSize="12" fontWeight="500" className="profile-chart-label">{d.x}</text>
            <text x={cx} y={Math.max(PAD.top, y - 6)} textAnchor="middle" fontSize="13" fontWeight="600" className="profile-chart-value">{primaryVal}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ScatterChart({ points, xKey, series }: {
  points: { x: number; values: Record<string, number>; label: string }[];
  xKey: AxisKey;
  series: ReturnType<typeof normalizeSeries>[];
}) {
  if (points.length === 0) return <p className="muted-copy">No data for scatter.</p>;
  const xs = points.map((p) => p.x);
  const allYs = points.flatMap((p) => series.map((s) => p.values[s.id]).filter((v): v is number => v != null));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...allYs);
  const yMax = Math.max(1, ...allYs);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const px = (v: number) => PAD.left + ((v - xMin) / xRange) * PLOT_W;
  const py = (v: number) => H - PAD.bottom - ((v - yMin) / yRange) * PLOT_H;
  const xMeta = METRIC_META[xKey as MetricKey];
  const gridLines = [0.25, 0.5, 0.75].map((f) => yMin + yRange * f);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profile-chart-svg">
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="profile-axis" />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="profile-axis" />
      {gridLines.map((gv, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={py(gv)} x2={W - PAD.right} y2={py(gv)} stroke="var(--line, #e5e7eb)" strokeWidth="1" strokeDasharray="4,4" />
          <text x={PAD.left - 6} y={py(gv) + 4} textAnchor="end" fontSize="10" className="profile-chart-label">{fmt(gv, 1)}</text>
        </g>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="11" className="profile-chart-label">{xMeta?.label || xKey}</text>
      {series.map((s) =>
        points.map((p, i) => {
          const yv = p.values[s.id];
          if (yv == null) return null;
          return (
            <g key={`${s.id}-${i}`} style={{ cursor: 'pointer' }}>
              <title>{`${xMeta?.label || xKey}: ${fmt(p.x, 1)} → ${s.label}: ${fmt(yv, 2, s.unit)}`}</title>
              <circle cx={px(p.x)} cy={py(yv)} r={5} fill={s.color} opacity={0.78} />
            </g>
          );
        }),
      )}
    </svg>
  );
}

function LineChart({ points, series }: {
  points: { label: string; values: Record<string, number> }[];
  series: ReturnType<typeof normalizeSeries>[];
}) {
  if (points.length === 0) return <p className="muted-copy">No trend data.</p>;
  const allYs = points.flatMap((p) => series.map((s) => p.values[s.id]).filter((v): v is number => v != null));
  const yMin = Math.min(0, ...allYs);
  const yMax = Math.max(1, ...allYs);
  const yRange = yMax - yMin || 1;

  const px = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * PLOT_W : PLOT_W / 2);
  const py = (v: number) => H - PAD.bottom - ((v - yMin) / yRange) * PLOT_H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profile-chart-svg">
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="profile-axis" />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="profile-axis" />
      {series.map((s) => {
        const linePoints = points
          .map((p, i) => {
            const value = p.values[s.id];
            if (value == null) return null;
            return { x: px(i), y: py(value), label: p.label, value };
          })
          .filter((point): point is NonNullable<typeof point> => point != null);
        if (linePoints.length < 2) return null;
        return (
          <g key={s.id}>
            <polyline
              points={linePoints.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeDasharray={lineDash(s.style)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {linePoints.map((p, i) => (
              <g key={i} style={{ cursor: 'pointer' }}>
                <title>{`${p.label}: ${s.label} = ${fmt(p.value, 2, s.unit)}`}</title>
                <circle cx={p.x} cy={p.y} r={4} fill={s.color} />
              </g>
            ))}
          </g>
        );
      })}
      {points.map((p, i) => (
        <text key={i} x={px(i)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize="11" className="profile-chart-label">{p.label}</text>
      ))}
    </svg>
  );
}

function HeatmapChart({ rows, cols, values, rowLabels, colLabels }: {
  rows: number;
  cols: number;
  values: number[][];
  rowLabels: string[];
  colLabels: string[];
}) {
  const maxVal = Math.max(1, ...values.flat().filter(Number.isFinite));
  const cellW = Math.min(64, PLOT_W / cols);
  const cellH = Math.min(36, PLOT_H / rows);

  return (
    <svg viewBox={`0 0 ${W} ${H + 10}`} className="profile-chart-svg">
      {values.map((row, ri) =>
        row.map((val, ci) => {
          const x = PAD.left + ci * cellW;
          const y = PAD.top + ri * cellH;
          const intensity = maxVal > 0 ? val / maxVal : 0;
          const r = Math.round(239 + (220 - 239) * intensity);
          const g = Math.round(246 + (38 - 246) * intensity);
          const b = Math.round(255 + (38 - 255) * intensity);
          return (
            <g key={`${ri}-${ci}`} style={{ cursor: 'pointer' }}>
              <title>{`${rowLabels[ri]} × ${colLabels[ci]}: ${fmt(val, 2)}`}</title>
              <rect x={x} y={y} width={cellW - 2} height={cellH - 2} rx={4} fill={`rgb(${r},${g},${b})`} />
              <text x={x + cellW / 2 - 1} y={y + cellH / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="600" fill={intensity > 0.5 ? '#fff' : 'var(--text, #111)'}>{fmt(val, 1)}</text>
            </g>
          );
        }),
      )}
      {colLabels.map((label, ci) => (
        <text key={ci} x={PAD.left + ci * cellW + cellW / 2 - 1} y={PAD.top + rows * cellH + 16} textAnchor="middle" fontSize="11" fontWeight="500" className="profile-chart-label">{label}</text>
      ))}
      {rowLabels.map((label, ri) => (
        <text key={ri} x={PAD.left - 6} y={PAD.top + ri * cellH + cellH / 2 + 1} textAnchor="end" dominantBaseline="middle" fontSize="11" fontWeight="500" className="profile-chart-label">{label}</text>
      ))}
    </svg>
  );
}

function ChartLegend({ series }: { series: ReturnType<typeof normalizeSeries>[] }) {
  return (
    <div className="profile-chart-legend">
      {series.map((s) => (
        <span key={s.id} className="profile-chart-legend-item">
          <span className="profile-chart-legend-swatch" style={{ background: s.color }} />
          <span className="profile-chart-legend-line" style={{ borderTopColor: s.color, borderTopStyle: s.style === 'dotted' ? 'dotted' : 'solid', opacity: s.style === 'dashed' ? 0.8 : 1, backgroundImage: s.style === 'dashed' ? `repeating-linear-gradient(to right, ${s.color}, ${s.color} 8px, transparent 8px, transparent 14px)` : 'none', borderTopWidth: s.style === 'dashed' ? 0 : 3 }} />
          <span>{s.label}{s.unit ? ` (${s.unit})` : ''}</span>
        </span>
      ))}
    </div>
  );
}

function ChartReadingGuideBlock({ guide, series }: { guide?: ChartReadingGuide; series: ReturnType<typeof normalizeSeries>[] }) {
  if (!guide || guide.notes.length === 0) return null;
  const seriesMap = new Map(series.map((s) => [s.id, s]));
  return (
    <section className="profile-chart-guide">
      <div>
        <h4>{guide.title || 'How to read this chart'}</h4>
        {guide.summary && <p>{guide.summary}</p>}
      </div>
      <ul className="profile-chart-guide-list">
        {guide.notes.map((note) => {
          const linkedSeries = note.seriesId ? seriesMap.get(note.seriesId) : null;
          const color = note.color || linkedSeries?.color || 'var(--line, #d1d5db)';
          return (
            <li key={note.id}>
              <span className="profile-chart-guide-dot" style={{ background: color }} />
              <div>
                <strong>{note.title}</strong>
                <p>{note.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function prepareBarData(roleRounds: RoleRound[], series: ReturnType<typeof normalizeSeries>[], crewWinThreshold: number) {
  return CVR_BANDS.map((band) => {
    const inBand = roleRounds.filter(({ round }) => {
      const cvr = extractMetric(round, 'cvr');
      return cvr != null && cvr >= band.min && cvr < band.max;
    });
    const passCount = inBand.filter(({ round }) => (extractMetric(round, 'meaning') ?? 0) > crewWinThreshold).length;
    const values: Record<string, number> = {};
    for (const s of series) {
      const vals = inBand.map(({ round }) => extractMetric(round, s.metric)).filter((v): v is number => v != null);
      values[s.id] = vals.length > 0 ? vals.reduce((sum, value) => sum + value, 0) / vals.length : 0;
    }
    return {
      x: `${band.label}\n${band.tag}`,
      values,
      passRate: inBand.length > 0 ? (passCount / inBand.length) * 100 : 0,
    };
  });
}

function prepareScatterData(roleRounds: RoleRound[], xKey: AxisKey, series: ReturnType<typeof normalizeSeries>[]) {
  return roleRounds
    .map(({ round }, i) => {
      const x = extractMetric(round, xKey as MetricKey);
      if (x == null) return null;
      const values: Record<string, number> = {};
      for (const s of series) {
        const value = extractMetric(round, s.metric);
        if (value != null) values[s.id] = value;
      }
      return { x, values, label: `R${i + 1}` };
    })
    .filter((point): point is NonNullable<typeof point> => point != null);
}

function prepareLineData(roleRounds: RoleRound[], series: ReturnType<typeof normalizeSeries>[]) {
  const sorted = [...roleRounds].sort((a, b) => new Date(a.round.createdAt).getTime() - new Date(b.round.createdAt).getTime());
  return sorted.map(({ round }, i) => {
    const values: Record<string, number> = {};
    for (const s of series) {
      const value = extractMetric(round, s.metric);
      if (value != null) values[s.id] = value;
    }
    return { label: `R${i + 1}`, values };
  });
}

function prepareHeatmapData(roleRounds: RoleRound[], series: ReturnType<typeof normalizeSeries>[]) {
  const heatmapSeries = series.length > 0 ? series : [normalizeSeries(makeOverrideSeries('tc')), normalizeSeries(makeOverrideSeries('tl')), normalizeSeries(makeOverrideSeries('lc'))];
  const allValues: Record<string, number[]> = Object.fromEntries(heatmapSeries.map((s) => [s.id, []]));
  for (const { round } of roleRounds) {
    for (const s of heatmapSeries) {
      const value = extractMetric(round, s.metric);
      if (value != null) allValues[s.id].push(value);
    }
  }
  const percentile = (arr: number[], val: number) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = sorted.findIndex((v) => v >= val);
    return idx < 0 ? 100 : (idx / sorted.length) * 100;
  };

  const recentRounds = roleRounds.slice(-12);
  const rowLabels = recentRounds.map((_, i) => `R${i + 1}`);
  const colLabels = heatmapSeries.map((s) => s.label);
  const values = recentRounds.map(({ round }) =>
    heatmapSeries.map((s) => {
      const value = extractMetric(round, s.metric);
      return value != null ? percentile(allValues[s.id], value) : 0;
    }),
  );
  return { rows: values.length, cols: heatmapSeries.length, values, rowLabels, colLabels };
}

export default function FlexibleChart({ roleRounds, presets, defaultPresetId, crewWinThreshold }: FlexibleChartProps) {
  const [activePresetId, setActivePresetId] = useState(defaultPresetId || presets[0]?.id || '');
  const [chartTypeOverride, setChartTypeOverride] = useState<ChartType | ''>('');
  const [xAxisOverride, setXAxisOverride] = useState<AxisKey | ''>('');
  const [yAxisOverride, setYAxisOverride] = useState<AxisKey | ''>('');

  const activePreset = presets.find((preset) => preset.id === activePresetId) || presets[0];
  const chartType = (chartTypeOverride || activePreset?.chartType || 'bar') as ChartType;
  const xAxis = (xAxisOverride || activePreset?.xAxis || 'cvrBand') as AxisKey;

  const activeSeries = useMemo(() => {
    const defaultSeries = activePreset?.series?.filter((series) => series.enabledByDefault !== false) || [];
    const presetSeries = defaultSeries.length > 0 ? defaultSeries : (activePreset?.series || []);
    if (yAxisOverride && yAxisOverride !== 'round' && yAxisOverride !== 'cvrBand') {
      return [normalizeSeries(makeOverrideSeries(yAxisOverride as MetricKey))];
    }
    return presetSeries.map(normalizeSeries);
  }, [activePreset, yAxisOverride]);

  const chart = useMemo(() => {
    if (roleRounds.length === 0) return <p className="muted-copy">No data to chart. Play more rounds.</p>;

    if (chartType === 'heatmap') {
      const heatmap = prepareHeatmapData(roleRounds, activeSeries);
      if (heatmap.rows === 0) return <p className="muted-copy">No data for heatmap.</p>;
      return <HeatmapChart {...heatmap} />;
    }

    if (chartType === 'bar' || xAxis === 'cvrBand') {
      const primarySeries = activeSeries[0];
      if (!primarySeries) return <p className="muted-copy">No series configured for this bar chart.</p>;
      const data = prepareBarData(roleRounds, activeSeries, crewWinThreshold);
      return <BarChart data={data} primarySeries={primarySeries} />;
    }

    if (chartType === 'scatter') {
      const points = prepareScatterData(roleRounds, xAxis, activeSeries);
      return <ScatterChart points={points} xKey={xAxis} series={activeSeries} />;
    }

    if (chartType === 'line' || xAxis === 'round') {
      const points = prepareLineData(roleRounds, activeSeries);
      return <LineChart points={points} series={activeSeries} />;
    }

    return <p className="muted-copy">Unsupported chart configuration.</p>;
  }, [roleRounds, chartType, xAxis, activeSeries, crewWinThreshold]);

  return (
    <div className="profile-chart-wrap">
      <div className="action-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <select
          value={activePresetId}
          onChange={(event) => {
            setActivePresetId(event.target.value);
            setChartTypeOverride('');
            setXAxisOverride('');
            setYAxisOverride('');
          }}
          className="chart-preset-select"
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6 }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
        <select value={chartTypeOverride || chartType} onChange={(event) => setChartTypeOverride(event.target.value as ChartType)} style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6 }}>
          {CHART_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
        <select value={xAxisOverride || xAxis} onChange={(event) => setXAxisOverride(event.target.value as AxisKey)} style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6 }}>
          {ALL_AXES.map((axis) => (
            <option key={axis.value} value={axis.value}>X: {axis.label}</option>
          ))}
        </select>
        <select value={yAxisOverride || activeSeries[0]?.metric || ''} onChange={(event) => setYAxisOverride(event.target.value as AxisKey)} style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6 }}>
          <option value="">Y: Preset series</option>
          {ALL_AXES.filter((axis) => axis.value !== 'round' && axis.value !== 'cvrBand').map((axis) => (
            <option key={axis.value} value={axis.value}>Y: {axis.label}</option>
          ))}
        </select>
      </div>
      {activePreset?.description && <p className="admin-message" style={{ marginBottom: 6 }}>{activePreset.description}</p>}
      <ChartLegend series={activeSeries} />
      {chart}
      <ChartReadingGuideBlock guide={activePreset?.readingGuide} series={activeSeries} />
    </div>
  );
}

export { CVR_BANDS, extractMetric, METRIC_META };
export type { ChartPreset, RoleRound, ChartType, MetricKey, AxisKey, ChartSeries, ChartNote, ChartReadingGuide };
