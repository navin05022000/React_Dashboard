import { useState, useMemo, useRef, useEffect } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import AIChat, { type DashboardAction } from "./AIChat";

// Use browser local time (IST) instead of UTC for all chart labels
// eslint-disable-next-line @typescript-eslint/no-explicit-any
Highcharts.setOptions({ time: { useUTC: false } as any });

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type LiveFilterKey = "1h" | "12h" | "24h";
type HistoryFilterKey = "yesterday" | "1week" | "1month" | "custom";
type Mode = "realtime" | "history";

interface ParamConfig {
  id: string;
  name: string;   // used in chart tooltip / series
  label: string;  // short alternative name shown in legend bar
  unit: string;
  color: string;
  yAxisIndex: number;
  opposite: boolean;
  min: number;
  max: number;
}

// â”€â”€â”€ Parameter definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PARAMS: ParamConfig[] = [
  { id: "tubing",    name: "Tub Pressure",     label: "TBG Press",   unit: "PSI", color: "#9b59b6", yAxisIndex: 0, opposite: false, min: 136.9, max: 137.6 },
  { id: "a_ann",     name: "A-Ann Pressure",  label: "A-Ann Press", unit: "PSI", color: "#27ae60", yAxisIndex: 1, opposite: false, min: 135.8, max: 138.2 },
  { id: "b_ann",     name: "B-Ann Pressure",  label: "B-Ann Press", unit: "PSI", color: "#2980b9", yAxisIndex: 2, opposite: false, min: 4.05,  max: 4.13  },
  { id: "flowline_p",name: "Fl-line Pressure",   label: "FL Press",    unit: "PSI", color: "#1a5e37", yAxisIndex: 3, opposite: true,  min: 121.5, max: 124.2 },
  { id: "flowline_t",name: "Fl-line Temperature",label: "FL Temp",     unit: "°F",  color: "#922b21", yAxisIndex: 4, opposite: true,  min: 22.0,  max: 22.52 },
];

// â”€â”€â”€ Data generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Smooth wave + noise via trig (deterministic so values don't jump on re-render)
const wave = (i: number, period: number, amp: number, phase: number) =>
  amp * Math.sin((i / period) * 2 * Math.PI + phase);

const makeSeries = (
  startMs: number,
  count: number,
  stepMs: number,
  base: number,
  amp1: number,
  amp2: number,
  phase: number
): [number, number][] =>
  Array.from({ length: count }, (_, i) => [
    startMs + i * stepMs,
    Math.round(
      (base +
        wave(i, count * 0.4, amp1, phase) +
        wave(i, count * 0.15, amp2, phase + 1.2) +
        wave(i, count * 0.07, amp2 * 0.4, phase + 2.5)) *
        100
    ) / 100,
  ]);

// Base timestamp: ~19:35 today (used only for history data)
const T0 = Date.UTC(2026, 1, 25, 19, 35, 0); // Feb 25 2026 19:35 UTC

const buildLiveData = (
  endMs: number,
  count: number,
  stepMs: number
): Record<string, [number, number][]> => {
  const startMs = endMs - count * stepMs;
  return {
    tubing:     makeSeries(startMs, count, stepMs, 137.25, 0.15, 0.06,  0.0),
    a_ann:      makeSeries(startMs, count, stepMs, 136.9,  0.7,  0.3,   1.0),
    b_ann:      makeSeries(startMs, count, stepMs, 4.088,  0.025,0.008, 2.1),
    flowline_p: makeSeries(startMs, count, stepMs, 122.8,  0.6,  0.25,  3.2),
    flowline_t: makeSeries(startMs, count, stepMs, 22.24,  0.12, 0.04,  0.8),
  };
};

const buildHistoryData = (
  daysBack: number,
  count: number,
  stepMs: number
): Record<string, [number, number][]> => {
  const start = T0 - daysBack * 24 * 3600 * 1000;
  return {
    tubing:     makeSeries(start, count, stepMs, 137.0,  0.2,  0.08, 0.5),
    a_ann:      makeSeries(start, count, stepMs, 136.5,  0.9,  0.35, 1.5),
    b_ann:      makeSeries(start, count, stepMs, 4.085,  0.03, 0.01, 2.6),
    flowline_p: makeSeries(start, count, stepMs, 122.5,  0.8,  0.3,  3.7),
    flowline_t: makeSeries(start, count, stepMs, 22.2,   0.15, 0.05, 1.3),
  };
};

const HISTORY_DATA: Record<string, Record<string, [number, number][]>> = {
  yesterday:  buildHistoryData(1,  96,  15 * 60 * 1000),
  "1week":    buildHistoryData(7,  168, 60 * 60 * 1000),
  "1month":   buildHistoryData(30, 180, 4  * 60 * 60 * 1000),
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const liveFilters: { label: string; key: LiveFilterKey }[] = [
  { label: "1 Hour",    key: "1h"  },
  { label: "12 Hours",  key: "12h" },
  { label: "24 Hours",  key: "24h" },
];

const historyFilters: { label: string; key: HistoryFilterKey }[] = [
  { label: "Yesterday",   key: "yesterday" },
  { label: "1 Week",      key: "1week"     },
  { label: "1 Month",     key: "1month"    },
  { label: "Custom Range",key: "custom"    },
];

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 22px",
  fontWeight: active ? 700 : 500,
  background: active ? "#1890ff" : "#fff",
  color:      active ? "#fff"    : "#595959",
  border:     active ? "1px solid #1890ff" : "1px solid #d9d9d9",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 15,
  fontFamily: "inherit",
  transition: "background 0.15s, color 0.15s, border-color 0.15s",
});

const FilterBtn = ({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...filterBtn(active),
        background: active ? "#1890ff" : hovered ? "#f0f7ff" : "#fff",
        color:      active ? "#fff"    : hovered ? "#1890ff" : "#595959",
        borderColor: active ? "#1890ff" : hovered ? "#1890ff" : "#d9d9d9",
      }}
    >
      {children}
    </button>
  );
};

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function LiveChart() {
  type ChartType = "line" | "spline" | "area" | "column";
  interface ParamSetting { min: number; max: number; }

  const defaultParamSettings: Record<string, ParamSetting> = Object.fromEntries(
    PARAMS.map((p) => [p.id, { min: p.min, max: p.max }])
  );

  const [mode, setMode] = useState<Mode>("realtime");
  const [liveKey, setLiveKey] = useState<LiveFilterKey>("1h");
  const [histKey, setHistKey] = useState<HistoryFilterKey>("yesterday");
  const [customStart, setCustomStart] = useState("");
  const [customEnd,   setCustomEnd]   = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [disabledParams, setDisabledParams] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("line");
  const [paramSettings, setParamSettings] = useState<Record<string, ParamSetting>>(defaultParamSettings);
  const [draftChartType, setDraftChartType] = useState<ChartType>("line");
  const [draftParamSettings, setDraftParamSettings] = useState<Record<string, ParamSetting>>(
    () => ({ ...defaultParamSettings })
  );
  const [liveSeriesData, setLiveSeriesData] = useState<Record<string, [number, number][]>>(() => {
    const now = Date.now();
    return buildLiveData(now, 60, 60 * 1000); // default 1h on mount
  });

  const chartRef    = useRef<HighchartsReact.RefObject>(null);
  const section2Ref = useRef<HTMLDivElement>(null);
  const legendBarRef = useRef<HTMLDivElement>(null);
  const menuRef     = useRef<HTMLDivElement>(null);

  // Close hamburger menu when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reset live data when filter key or mode changes
  useEffect(() => {
    if (mode !== "realtime") return;
    const now = Date.now();
    const configs: Record<LiveFilterKey, [number, number]> = {
      "1h":  [60,  60 * 1000],
      "12h": [144, 5  * 60 * 1000],
      "24h": [144, 10 * 60 * 1000],
    };
    const [count, stepMs] = configs[liveKey];
    setLiveSeriesData(buildLiveData(now, count, stepMs));
  }, [mode, liveKey]);

  // Append a new point every 10 seconds in live mode
  useEffect(() => {
    if (mode !== "realtime") return;
    const id = setInterval(() => {
      const now = Date.now();
      setLiveSeriesData((prev) => {
        const next: Record<string, [number, number][]> = {};
        for (const p of PARAMS) {
          const pts = prev[p.id] ?? [];
          const last = pts.length ? pts[pts.length - 1][1] : p.min;
          const range = p.max - p.min;
          // small bounded random walk
          const delta = (Math.random() - 0.5) * range * 0.04;
          const newVal = Math.round(Math.min(p.max, Math.max(p.min, last + delta)) * 100) / 100;
          next[p.id] = [...pts, [now, newVal]];
        }
        return next;
      });
    }, 10_000);
    return () => clearInterval(id);
  }, [mode]);

  const downloadPNG = async () => {
    setShowMenu(false);
    const chartContainer = chartRef.current?.container.current;
    const legendBar = legendBarRef.current;
    if (!chartContainer || !legendBar) return;

    // 1. Capture legend bar HTML via html2canvas (HTML renders fine)
    const legendCanvas = await html2canvas(legendBar, {
      backgroundColor: "#fafafa",
      scale: 2,
      useCORS: true,
      logging: false,
    });

    // 2. Serialize chart SVG to an Image
    const svgEl = chartContainer.querySelector("svg");
    if (!svgEl) return;

    // Inline font/styles so the SVG renders correctly as a standalone image
    const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgString = new XMLSerializer().serializeToString(svgClone);
    const svgBlob   = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl    = URL.createObjectURL(svgBlob);

    const svgImg    = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = svgUrl;
    });
    URL.revokeObjectURL(svgUrl);

    // 3. Composite: legend on top, chart below
    const scale = 2;
    const svgW  = svgEl.clientWidth  || 1200;
    const svgH  = svgEl.clientHeight || 520;
    const legH  = legendBar.offsetHeight;

    const final  = document.createElement("canvas");
    final.width  = svgW * scale;
    final.height = (legH + svgH) * scale;

    const ctx = final.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, final.width, final.height);

    // draw legend bar
    ctx.drawImage(legendCanvas, 0, 0, svgW * scale, legH * scale);
    // draw SVG chart below
    ctx.drawImage(svgImg, 0, legH * scale, svgW * scale, svgH * scale);

    const a = document.createElement("a");
    a.download = "monitoring-chart.png";
    a.href = final.toDataURL("image/png");
    a.click();
  };

  const downloadXLSX = () => {
    const firstSeries = seriesData[PARAMS[0].id] ?? [];
    const header = ["Timestamp", ...PARAMS.map((p) => `${p.name} (${p.unit})`)];
    const rows = firstSeries.map((pt, i) => [
      new Date(pt[0]).toLocaleString(),
      ...PARAMS.map((p) => seriesData[p.id]?.[i]?.[1] ?? ""),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Chart Data");
    XLSX.writeFile(wb, "monitoring-data.xlsx");
    setShowMenu(false);
  };

  const toggleParam = (id: string) =>
    setDisabledParams((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const activeKey: string =
    mode === "realtime" ? liveKey : histKey === "custom" ? "1week" : histKey;

  const seriesData = useMemo(() => {
    if (mode === "realtime") return liveSeriesData;
    return HISTORY_DATA[activeKey] ?? HISTORY_DATA["yesterday"];
  }, [mode, liveSeriesData, activeKey]);

  // Derive exact xAxis min/max from first series data so chart fills the range precisely
  const xAxisRange = useMemo(() => {
    const pts = seriesData[PARAMS[0].id] ?? [];
    if (pts.length < 2) return { min: undefined, max: undefined };
    return { min: pts[0][0], max: pts[pts.length - 1][0] };
  }, [seriesData]);

  // Most-recent value per param
  const latestValues = useMemo(
    () =>
      Object.fromEntries(
        PARAMS.map((p) => {
          const pts = seriesData[p.id] ?? [];
          return [p.id, pts.length ? pts[pts.length - 1][1] : 0];
        })
      ),
    [seriesData]
  );

  // Highcharts options
  const options: Highcharts.Options = useMemo(() => ({
    chart: {
      type: "line",
      height: 520,
      marginLeft: 195,
      marginRight: 130,
      animation: false,
      style: { fontFamily: "Inter, sans-serif" },
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    tooltip: {
      shared: true,
      useHTML: true,
      xDateFormat: "%Y-%m-%d %H:%M",
      backgroundColor: "#fff",
      borderColor: "#e0e0e0",
      borderRadius: 10,
      shadow: true,
      padding: 16,
      style: { fontSize: "14px", color: "#262626", pointerEvents: "none" },
      headerFormat:
        `<div style="margin-bottom:10px;font-size:13px;color:#8c8c8c;font-weight:500">{point.key:${
          mode === "history" && (histKey === "1week" || histKey === "1month" || histKey === "custom")
            ? "%e %b %Y %H:%M"
            : "%H:%M"
        }}</div>` +
        '<table style="border-collapse:collapse;width:100%">',
      pointFormatter: function (this: Highcharts.Point): string {
        const color = (this.series as Highcharts.Series).color as string;
        const name = this.series.name;
        const val = (this.y as number).toFixed(2);
        return (
          `<tr style="line-height:2">` +
          `<td style="padding-right:12px">` +
          `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>` +
          `<span style="color:#595959;font-size:13px">${name}</span>` +
          `</td>` +
          `<td style="text-align:right;font-weight:700;font-size:14px;color:${color}">${val}</td>` +
          `</tr>`
        );
      },
      footerFormat: "</table>",
    },
    xAxis: {
      type: "datetime",
      tickPixelInterval: 80,
      tickInterval: (mode === "history" && (histKey === "1week" || histKey === "1month" || histKey === "custom"))
        ? 24 * 3600 * 1000   // one tick per day
        : undefined,
      min: xAxisRange.min,
      max: xAxisRange.max,
      startOnTick: false,
      endOnTick: false,
      minPadding: 0,
      maxPadding: 0,
      labels: {
        format: (mode === "history" && (histKey === "1week" || histKey === "1month" || histKey === "custom"))
          ? "{value:%e %b}"
          : "{value:%H:%M}",
        style: { fontSize: "11px" },
      },
      lineColor: "#e0e0e0",
      tickColor: "#e0e0e0",
    },
    yAxis: PARAMS.map((p, idx) => ({
      title: { text: undefined },
      labels: {
        format: `{value}`,
        style: { color: p.color, fontSize: "11px" },
        align: p.opposite ? "left" : "right",
      },
      lineColor: p.color,
      lineWidth: 1,
      tickColor: p.color,
      gridLineWidth: idx === 0 ? 1 : 0,
      opposite: p.opposite,
      min: paramSettings[p.id]?.min ?? p.min,
      max: paramSettings[p.id]?.max ?? p.max,
      // Offset stacks axes side-by-side
      offset: p.opposite
        ? (idx === 4 ? 70 : 0)   // right: idx4 pushed further right
        : (idx === 0 ? 130 : idx === 1 ? 65 : 0), // left: spread out
    })),
    series: PARAMS.map((p) => ({
      type: chartType as Highcharts.SeriesOptionsType["type"],
      name: p.name,
      data: seriesData[p.id] ?? [],
      color: p.color,
      yAxis: p.yAxisIndex,
      lineWidth: 1.5,
      marker: { enabled: false },
      visible: !disabledParams.has(p.id),
    })),
    plotOptions: {
      line: { animation: false },
      spline: { animation: false },
      area: { animation: false },
      column: { animation: false },
    },
  }), [seriesData, disabledParams, xAxisRange, mode, histKey, chartType, paramSettings]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* â”€â”€ Toolbar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #e8e8e8",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {/* Left: time filter buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {mode === "realtime"
            ? liveFilters.map((f) => (
                <FilterBtn key={f.key} active={liveKey === f.key} onClick={() => setLiveKey(f.key)}>
                  {f.label}
                </FilterBtn>
              ))
            : historyFilters.map((f) => (
                <FilterBtn key={f.key} active={histKey === f.key} onClick={() => setHistKey(f.key)}>
                  {f.label}
                </FilterBtn>
              ))}

          {mode === "history" && histKey === "custom" && (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d9d9d9", fontSize: 13 }}
              />
              <span style={{ color: "#aaa", fontSize: 13 }}>to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d9d9d9", fontSize: 13 }}
              />
            </span>
          )}
        </div>

        {/* Right: Mode + Settings */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18, color: "#595959", fontWeight: 600 }}>Mode :</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            style={{
              padding: "8px 32px 8px 14px",
              borderRadius: 12,
              border: "1px solid #d9d9d9",
              fontSize: 18,
              cursor: "pointer",
              background: "#fff",
              fontFamily: "inherit",
              color: "#262626",
            }}
          >
            <option value="realtime">Live</option>
            <option value="history">History</option>
          </select>

          <button
            onClick={() => {
              if (!showSettings) {
                setDraftChartType(chartType);
                setDraftParamSettings({ ...paramSettings });
              }
              setShowSettings((v) => !v);
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f7ff"; e.currentTarget.style.color = "#1890ff"; e.currentTarget.style.borderColor = "#1890ff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = showSettings ? "#f0f7ff" : "#fff"; e.currentTarget.style.color = showSettings ? "#1890ff" : "#595959"; e.currentTarget.style.borderColor = showSettings ? "#1890ff" : "#d9d9d9"; }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 18px",
              border: showSettings ? "1px solid #1890ff" : "1px solid #d9d9d9",
              borderRadius: 8,
              background: showSettings ? "#f0f7ff" : "#fff",
              cursor: "pointer",
              fontSize: 18,
              fontWeight: 700,
              color: showSettings ? "#1890ff" : "#595959",
              fontFamily: "inherit",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
            }}
          >
            Settings <span style={{ fontSize: 24, lineHeight: 1 }}>⚙</span>
          </button>
        </div>
      </div>

      {/* Section 2: Legend + Chart */}
      <div
        ref={section2Ref}
        style={{
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #e8e8e8",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Settings Panel Overlay */}
        {showSettings && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={(e) => { if (e.target === e.currentTarget) { setDraftChartType(chartType); setDraftParamSettings({ ...paramSettings }); setShowSettings(false); } }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #e8e8e8",
                padding: "24px 32px",
                fontFamily: "Inter, sans-serif",
                width: 440,
                maxWidth: "90%",
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              }}
            >
              <h3 style={{ margin: "0 0 18px 0", fontSize: 16, fontWeight: 700, color: "#262626" }}>
                Chart Settings
              </h3>

              {/* Chart Type */}
              <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
                <label style={{ fontWeight: 600, fontSize: 14, color: "#595959", minWidth: 120 }}>
                  Chart Type
                </label>
                <select
                  value={draftChartType}
                  onChange={(e) => setDraftChartType(e.target.value as ChartType)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid #d9d9d9",
                    fontSize: 14,
                    color: "#262626",
                    background: "#fafafa",
                    cursor: "pointer",
                  }}
                >
                  <option value="line">Line</option>
                  <option value="spline">Spline</option>
                  <option value="area">Area</option>
                  <option value="column">Column</option>
                </select>
              </div>

              {/* Per-Parameter Min/Max */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #f0f0f0" }}>
                      <th style={{ textAlign: "left", padding: "8px 16px 10px 0", color: "#8c8c8c", fontWeight: 600 }}>
                        Parameter
                      </th>
                      <th style={{ textAlign: "center", padding: "8px 16px 10px", color: "#8c8c8c", fontWeight: 600 }}>
                        Min
                      </th>
                      <th style={{ textAlign: "center", padding: "8px 0 10px 16px", color: "#8c8c8c", fontWeight: 600 }}>
                        Max
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PARAMS.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ padding: "10px 16px 10px 0", fontWeight: 600, color: p.color }}>
                          {p.label}
                        </td>
                        <td style={{ padding: "10px 16px", textAlign: "center" }}>
                          <input
                            type="number"
                            value={draftParamSettings[p.id]?.min ?? p.min}
                            onChange={(e) =>
                              setDraftParamSettings((prev) => ({
                                ...prev,
                                [p.id]: { ...prev[p.id], min: Number(e.target.value) },
                              }))
                            }
                            style={{
                              width: 90,
                              padding: "5px 10px",
                              borderRadius: 6,
                              border: "1px solid #d9d9d9",
                              fontSize: 14,
                              textAlign: "center",
                              color: "#262626",
                              background: "#fafafa",
                            }}
                          />
                        </td>
                        <td style={{ padding: "10px 0 10px 16px", textAlign: "center" }}>
                          <input
                            type="number"
                            value={draftParamSettings[p.id]?.max ?? p.max}
                            onChange={(e) =>
                              setDraftParamSettings((prev) => ({
                                ...prev,
                                [p.id]: { ...prev[p.id], max: Number(e.target.value) },
                              }))
                            }
                            style={{
                              width: 90,
                              padding: "5px 10px",
                              borderRadius: 6,
                              border: "1px solid #d9d9d9",
                              fontSize: 14,
                              textAlign: "center",
                              color: "#262626",
                              background: "#fafafa",
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    setDraftChartType(chartType);
                    setDraftParamSettings({ ...paramSettings });
                    setShowSettings(false);
                  }}
                  style={{
                    padding: "8px 22px",
                    borderRadius: 7,
                    border: "1px solid #d9d9d9",
                    fontSize: 14,
                    fontWeight: 600,
                    background: "#fff",
                    color: "#595959",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setChartType(draftChartType);
                    setParamSettings({ ...draftParamSettings });
                    setShowSettings(false);
                  }}
                  style={{
                    padding: "8px 22px",
                    borderRadius: 7,
                    border: "none",
                    fontSize: 14,
                    fontWeight: 700,
                    background: "#1677ff",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

      {/* â”€â”€ Inline Legend Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div
        ref={legendBarRef}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 24px",
          borderBottom: "1px solid #f0f0f0",
          gap: 28,
          flexWrap: "wrap",
          background: "#fafafa",
          position: "relative",
        }}
      >
        {PARAMS.map((p) => {
          const disabled = disabledParams.has(p.id);
          return (
            <span
              key={p.id}
              onClick={() => toggleParam(p.id)}
              title={disabled ? `Show ${p.label}` : `Hide ${p.label}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 16,
                cursor: "pointer",
                opacity: disabled ? 0.35 : 1,
                transition: "opacity 0.2s",
                userSelect: "none",
              }}
            >
              {/* colored dash line */}
              <span
                style={{
                  display: "inline-block",
                  width: 28,
                  height: 3,
                  background: disabled ? "#bbb" : p.color,
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: disabled ? "#aaa" : p.color,
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: disabled ? "line-through" : "none",
                  letterSpacing: "0.01em",
                }}
              >
                {p.label}:&nbsp;
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  {latestValues[p.id]?.toFixed(2)}
                </span>
              </span>
            </span>
          );
        })}

        {/* Hamburger menu — pinned to right */}
        <div
          ref={menuRef}
          style={{ position: "absolute", right: 16, display: "inline-block" }}
        >
          <span
            onClick={() => setShowMenu((v) => !v)}
            style={{
              fontSize: 22,
              color: "#595959",
              cursor: "pointer",
              lineHeight: 1,
              userSelect: "none",
              padding: "2px 6px",
              borderRadius: 4,
              background: showMenu ? "#f0f0f0" : "transparent",
              display: "inline-block",
            }}
            title="Export options"
          >
            ☰
          </span>
          {showMenu && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: "#fff",
                border: "1px solid #e0e0e0",
                borderRadius: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                minWidth: 180,
                zIndex: 999,
                overflow: "hidden",
              }}
            >
              {[
                { label: "📷  Download PNG",  action: downloadPNG  },
                { label: "📊  Download XLSX", action: downloadXLSX },
              ].map(({ label, action }) => (
                <div
                  key={label}
                  onClick={action}
                  style={{
                    padding: "11px 18px",
                    fontSize: 14,
                    cursor: "pointer",
                    color: "#262626",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* â”€â”€ Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={{ padding: "8px 16px 16px 16px" }}>
        <HighchartsReact highcharts={Highcharts} options={options} ref={chartRef} allowChartUpdate={true} immutable={false} />
      </div>
      </div>

      {/* ── AI Chat Layer ────────────────────────────────────────────────── */}
      <AIChat
        onActions={(actions: DashboardAction[]) => {
          actions.forEach((a) => {
            switch (a.type) {
              case "showOnlyParams":
                setDisabledParams(new Set(PARAMS.map(p => p.id).filter(id => !a.params!.includes(id))));
                break;
              case "showAllParams":
                setDisabledParams(new Set());
                break;
              case "hideParam":
                setDisabledParams((prev) => new Set([...prev, a.param!]));
                break;
              case "showParam":
                setDisabledParams((prev) => { const n = new Set(prev); n.delete(a.param!); return n; });
                break;
              case "setMode":
                setMode(a.mode!);
                break;
              case "setLiveKey":
                setMode("realtime");
                setLiveKey(a.liveKey!);
                break;
              case "setHistKey":
                setMode("history");
                setHistKey(a.histKey!);
                break;
              case "setChartType":
                setChartType(a.chartType!);
                break;
            }
          });
        }}
      />
    </div>
  );
}
