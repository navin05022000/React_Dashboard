import { useState, useRef, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
type ChartType   = "line" | "spline" | "area" | "column";
type Mode        = "realtime" | "history";
type LiveKey     = "1h" | "12h" | "24h";
type HistKey     = "yesterday" | "1week" | "1month";

export interface DashboardAction {
  type: "showOnlyParams" | "showAllParams" | "hideParam" | "showParam"
      | "setMode" | "setLiveKey" | "setHistKey" | "setChartType";
  params?:    string[];
  param?:     string;
  mode?:      Mode;
  liveKey?:   LiveKey;
  histKey?:   HistKey;
  chartType?: ChartType;
}

export interface AIChatProps {
  onActions: (actions: DashboardAction[]) => void;
}

// ─── Param catalogue for the system prompt ───────────────────────────────────
const PARAM_INFO = `
- tubing      → Tubing Pressure (PSI)
- a_ann       → A-Annulus Pressure (PSI)
- b_ann       → B-Annulus Pressure (PSI)
- flowline_p  → Flowline Pressure (PSI)
- flowline_t  → Flowline Temperature (°F)
`.trim();

const SYSTEM_PROMPT = `
You are an AI assistant embedded in an oil & gas well monitoring dashboard.
The dashboard displays 5 real-time sensor parameters:
${PARAM_INFO}

You help users explore the data by interpreting natural-language queries and
returning structured JSON instructions that control the dashboard.

Available actions (use exact field names and values):
1. showOnlyParams  – { "type": "showOnlyParams", "params": ["tubing","flowline_t"] }
2. showAllParams   – { "type": "showAllParams" }
3. hideParam       – { "type": "hideParam",  "param": "b_ann" }
4. showParam       – { "type": "showParam",  "param": "flowline_p" }
5. setMode         – { "type": "setMode",    "mode": "realtime" }   // "realtime" | "history"
6. setLiveKey      – { "type": "setLiveKey", "liveKey": "1h" }      // "1h","12h","24h"
7. setHistKey      – { "type": "setHistKey", "histKey": "1week" }   // "yesterday","1week","1month"
8. setChartType    – { "type": "setChartType","chartType": "spline" } // "line","spline","area","column"

Rules:
- ALWAYS respond with valid JSON only — no markdown, no code fences, no extra text.
- If multiple actions are needed, include them all in the "actions" array.
- "reply" must be a short, friendly 1-2 sentence explanation of what you did.
- If the query is unclear return { "reply": "...", "actions": [] }.

Response format:
{
  "reply": "string",
  "actions": [ ...action objects... ]
}
`.trim();

// ─── Local NLP interpreter (no API key needed) ───────────────────────────────
const PARAM_ALIASES: Record<string, string> = {
  // tubing
  tubing: "tubing", "tubing pressure": "tubing", tub: "tubing", tbg: "tubing",
  // a_ann
  a_ann: "a_ann", "a-ann": "a_ann", "a ann": "a_ann", "a-annulus": "a_ann",
  "a annulus": "a_ann", aann: "a_ann",
  // b_ann
  b_ann: "b_ann", "b-ann": "b_ann", "b ann": "b_ann", "b-annulus": "b_ann",
  "b annulus": "b_ann", bann: "b_ann",
  // flowline_p
  flowline_p: "flowline_p", "flowline pressure": "flowline_p", "fl pressure": "flowline_p",
  "fl press": "flowline_p", "flowline p": "flowline_p", flp: "flowline_p",
  "fl-line pressure": "flowline_p",
  // flowline_t
  flowline_t: "flowline_t", "flowline temperature": "flowline_t", "fl temperature": "flowline_t",
  "fl temp": "flowline_t", "flowline t": "flowline_t", flt: "flowline_t",
  "fl-line temperature": "flowline_t", temperature: "flowline_t", temp: "flowline_t",
};

const PRESSURE_PARAMS = ["tubing", "a_ann", "b_ann", "flowline_p"];

const PARAM_LABELS: Record<string, string> = {
  tubing:     "Tubing Pressure",
  a_ann:      "A-Ann Pressure",
  b_ann:      "B-Ann Pressure",
  flowline_p: "Flowline Pressure",
  flowline_t: "Flowline Temperature",
};

function resolveParams(q: string): string[] {
  const found: string[] = [];
  const sorted = Object.keys(PARAM_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    if (q.includes(alias) && !found.includes(PARAM_ALIASES[alias])) {
      found.push(PARAM_ALIASES[alias]);
    }
  }
  return found;
}

function interpretQuery(raw: string): { reply: string; actions: DashboardAction[] } {
  const q = raw.toLowerCase().trim();
  const actions: DashboardAction[] = [];

  // ── Chart type ───────────────────────────────────────────────────────────
  const chartTypeMatch = q.match(/\b(spline|area|column|bar|line)\b/);
  if (chartTypeMatch) {
    const ct = chartTypeMatch[1] === "bar" ? "column" : chartTypeMatch[1] as ChartType;

    if (/switch|change|use|set|convert|make/.test(q) ||
        /chart|graph|plot|type|view/.test(q)) {
      actions.push({ type: "setChartType", chartType: ct });
      return { reply: `Switched to ${ct} chart type.`, actions };
    }
  }

  // ── Mode: live / realtime ────────────────────────────────────────────────
  if (/\b(live|real.?time|realtime|real time|now)\b/.test(q) && !/history/.test(q)) {
    const liveMatch = q.match(/\b(1\s*h(our)?|12\s*h(our)?|24\s*h(our)?)\b/);
    const keyMap: Record<string, LiveKey> = {
      "1": "1h", "12": "12h", "24": "24h",
    };
    const numMatch = q.match(/\b(1|12|24)\s*h/);
    const lk: LiveKey = numMatch ? (keyMap[numMatch[1]] ?? "1h") : "1h";
    if (liveMatch || /last\s+(1|12|24)/.test(q)) {
      actions.push({ type: "setLiveKey", liveKey: lk });
      return { reply: `Switched to live mode — last ${lk}.`, actions };
    }
    actions.push({ type: "setMode", mode: "realtime" });
    return { reply: "Switched to live (real-time) mode.", actions };
  }

  // ── History window ───────────────────────────────────────────────────────
  if (/\b(histor|yesterday|week|month|past|last\s+\d)\b/.test(q)) {
    if (/yesterday/.test(q)) {
      actions.push({ type: "setHistKey", histKey: "yesterday" });
      return { reply: "Showing yesterday's data.", actions };
    }
    if (/1\s*month|30\s*day|monthly/.test(q)) {
      actions.push({ type: "setHistKey", histKey: "1month" });
      return { reply: "Showing last 1-month history.", actions };
    }
    if (/1\s*week|7\s*day|weekly/.test(q)) {
      actions.push({ type: "setHistKey", histKey: "1week" });
      return { reply: "Showing last 1-week history.", actions };
    }
    actions.push({ type: "setMode", mode: "history" });
    return { reply: "Switched to history mode.", actions };
  }

  // ── Time window for live ─────────────────────────────────────────────────
  if (/\b24\s*h(our)?s?\b/.test(q)) {
    actions.push({ type: "setLiveKey", liveKey: "24h" });
    return { reply: "Showing last 24 hours of live data.", actions };
  }
  if (/\b12\s*h(our)?s?\b/.test(q)) {
    actions.push({ type: "setLiveKey", liveKey: "12h" });
    return { reply: "Showing last 12 hours of live data.", actions };
  }
  if (/\b1\s*h(our)?\b/.test(q)) {
    actions.push({ type: "setLiveKey", liveKey: "1h" });
    return { reply: "Showing last 1 hour of live data.", actions };
  }

  // ── Show all ─────────────────────────────────────────────────────────────
  if (/\b(all|every(thing)?|show all|reset)\b/.test(q) && !/hide|remove/.test(q)) {
    actions.push({ type: "showAllParams" });
    return { reply: "All parameters are now visible.", actions };
  }

  // ── Show only pressure sensors ───────────────────────────────────────────
  if (/pressure.*(only|sensor|param)|only.*(pressure|press)|pressure\s+sensor/.test(q) ||
      q === "pressure" || q === "pressures") {
    actions.push({ type: "showOnlyParams", params: PRESSURE_PARAMS });
    return { reply: "Showing only the 4 pressure parameters.", actions };
  }

  // ── Hide / show specific param ───────────────────────────────────────────
  const isHide = /\b(hide|remove|turn off|disable|off)\b/.test(q);
  const isShow = /\b(show|display|enable|turn on|on)\b/.test(q);
  const resolved = resolveParams(q);

  if (resolved.length > 0) {
    if (isHide && !isShow) {
      resolved.forEach((pid) => actions.push({ type: "hideParam", param: pid }));
      const names = resolved.map(pid => PARAM_LABELS[pid] ?? pid).join(", ");
      return { reply: `Hidden: ${names}.`, actions };
    }
    if (isShow || !isHide) {
      if (/only/.test(q)) {
        actions.push({ type: "showOnlyParams", params: resolved });
        const names = resolved.map(pid => PARAM_LABELS[pid] ?? pid).join(", ");
        return { reply: `Showing only: ${names}.`, actions };
      }
      resolved.forEach((pid) => actions.push({ type: "showParam", param: pid }));
      const names = resolved.map(pid => PARAM_LABELS[pid] ?? pid).join(", ");
      return { reply: `Showing: ${names}.`, actions };
    }
  }

  // ── Chart type (second pass — just the word alone) ───────────────────────
  if (chartTypeMatch) {
    const ct = chartTypeMatch[1] === "bar" ? "column" : chartTypeMatch[1] as ChartType;
    actions.push({ type: "setChartType", chartType: ct });
    return { reply: `Switched to ${ct} chart.`, actions };
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return {
    reply: "I didn't quite understand that. Try asking things like \"Show only pressure sensors\", \"Switch to 1-week history\", or \"Use spline chart\".",
    actions: [],
  };
}

async function callOpenAI(userMessage: string): Promise<{ reply: string; actions: DashboardAction[] }> {
  const apiKey = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim();

  // Use local interpreter when no key is configured
  if (!apiKey || apiKey.startsWith("sk-...")) {
    return interpretQuery(userMessage);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userMessage   },
        ],
      }),
    });

    if (!res.ok) {
      // Quota / billing / rate-limit → fall back silently
      const err = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      if (res.status === 429 || err?.error?.code === "insufficient_quota") {
        return interpretQuery(userMessage);
      }
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw = data.choices[0]?.message?.content ?? "{}";
    return JSON.parse(raw) as { reply: string; actions: DashboardAction[] };
  } catch {
    // Any network / parse error → fall back to local
    return interpretQuery(userMessage);
  }
}

// ─── Quick-action chips (full pool) ─────────────────────────────────────────
const ALL_SUGGESTIONS = [
  "Show only pressure sensors",
  "Switch to 1-week history",
  "Show flowline temperature only",
  "Switch to spline chart",
  "Show all parameters",
  "Show last 24 hours live data",
  "Switch to area chart",
  "Show yesterday's data",
  "Hide B-annulus pressure",
  "Switch to line chart",
  "Show last 12 hours",
  "Switch to column chart",
  "Show last 1 month history",
  "Show tubing pressure only",
  "Switch to realtime mode",
  "Show A-annulus and tubing only",
];

const CHIPS_VISIBLE = 4;

// ─── Message type ────────────────────────────────────────────────────────────
interface Message {
  id:      number;
  role:    "user" | "assistant" | "error";
  text:    string;
  actions?: DashboardAction[];
}

function describeActions(actions: DashboardAction[]): string {
  return actions.map((a) => {
    switch (a.type) {
      case "showOnlyParams":  return `Showing: ${a.params!.map(p => PARAM_LABELS[p] ?? p).join(", ")}`;
      case "showAllParams":   return "All parameters shown";
      case "hideParam":       return `Hidden: ${PARAM_LABELS[a.param!] ?? a.param}`;
      case "showParam":       return `Shown: ${PARAM_LABELS[a.param!] ?? a.param}`;
      case "setMode":         return `Mode → ${a.mode === "realtime" ? "Live" : "History"}`;
      case "setLiveKey":      return `Time window → ${a.liveKey}`;
      case "setHistKey":      return `History range → ${a.histKey}`;
      case "setChartType":    return `Chart type → ${a.chartType}`;
      default: return "";
    }
  }).filter(Boolean).join(" · ");
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function AIChat({ onActions }: AIChatProps) {
  const [open,     setOpen]    = useState(false);
  const [input,    setInput]   = useState("");
  const [loading,  setLoading] = useState(false);
  const [usedChips, setUsedChips] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Message[]>([
    {
      id:   0,
      role: "assistant",
      text: "Hi! I'm your AI dashboard assistant. Ask me things like \"Show only pressure readings\" or \"Switch to 1-week history\".",
    },
  ]);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  // Compute visible chips: next CHIPS_VISIBLE unused; recycle when all used
  const visibleChips = (() => {
    const unused = ALL_SUGGESTIONS.filter((s) => !usedChips.has(s));
    const pool   = unused.length >= CHIPS_VISIBLE ? unused : ALL_SUGGESTIONS;
    return pool.slice(0, CHIPS_VISIBLE);
  })();

  const sendChip = (text: string) => {
    setUsedChips((prev) => new Set([...prev, text]));
    send(text);
  };

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const addMessage = (msg: Omit<Message, "id">) =>
    setMessages((prev) => [...prev, { ...msg, id: Date.now() }]);

  const send = async (text: string) => {
    const query = text.trim();
    if (!query || loading) return;
    setInput("");
    addMessage({ role: "user", text: query });
    setLoading(true);
    try {
      const result = await callOpenAI(query);
      if (result.actions?.length) onActions(result.actions);
      addMessage({ role: "assistant", text: result.reply, actions: result.actions });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage({ role: "error", text: `Error: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const panelStyle: React.CSSProperties = {
    position:     "fixed",
    bottom:       24,
    right:        24,
    width:        380,
    height:       560,
    background:   "#fff",
    borderRadius: 16,
    boxShadow:    "0 12px 48px rgba(0,0,0,0.22)",
    display:      "flex",
    flexDirection:"column",
    zIndex:       1000,
    fontFamily:   "Inter, sans-serif",
    border:       "1px solid #e8e8e8",
    overflow:     "hidden",
    transform:    open ? "scale(1) translateY(0)" : "scale(0.92) translateY(20px)",
    opacity:      open ? 1 : 0,
    pointerEvents:open ? "all" : "none",
    transition:   "transform 0.2s ease, opacity 0.2s ease",
    transformOrigin: "bottom right",
  };

  const fabStyle: React.CSSProperties = {
    position:     "relative",
    width:        56,
    height:       56,
    borderRadius: "50%",
    background:   open ? "#e6f0ff" : "#1677ff",
    border:       "none",
    cursor:       "pointer",
    display:      "flex",
    alignItems:   "center",
    justifyContent:"center",
    boxShadow:    "0 4px 20px rgba(22,119,255,0.45)",
    transition:   "background 0.2s, transform 0.2s",
    fontSize:     22,
  };

  return (
    <>
      {/* ── Floating Action Button ─────────────────────────────────────────── */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1001 }}>

        {/* Pulse rings — only when panel is closed */}
        {!open && (
          <>
            <div style={{
              position: "absolute", inset: -8,
              borderRadius: "50%",
              border: "2px solid rgba(22,119,255,0.5)",
              animation: "fabPulse 2s ease-out infinite",
              pointerEvents: "none",
            }} />
            <div style={{
              position: "absolute", inset: -8,
              borderRadius: "50%",
              border: "2px solid rgba(22,119,255,0.3)",
              animation: "fabPulse 2s ease-out 0.6s infinite",
              pointerEvents: "none",
            }} />
            <div style={{
              position: "absolute", inset: -8,
              borderRadius: "50%",
              border: "2px solid rgba(22,119,255,0.15)",
              animation: "fabPulse 2s ease-out 1.2s infinite",
              pointerEvents: "none",
            }} />
          </>
        )}

        {/* "Ask AI" label tooltip */}
        {!open && (
          <div style={{
            position: "absolute",
            right: 66,
            top: "50%",
            transform: "translateY(-50%)",
            background: "#1677ff",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 11px",
            borderRadius: 20,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 10px rgba(22,119,255,0.35)",
            animation: "fabLabelPop 0.4s ease both",
            pointerEvents: "none",
          }}>
            Ask AI
            {/* Arrow */}
            <div style={{
              position: "absolute", right: -6, top: "50%",
              transform: "translateY(-50%)",
              width: 0, height: 0,
              borderTop: "5px solid transparent",
              borderBottom: "5px solid transparent",
              borderLeft: "6px solid #1677ff",
            }} />
          </div>
        )}

        {/* Notification dot */}
        {!open && (
          <div style={{
            position: "absolute", top: -3, right: -3,
            width: 13, height: 13,
            borderRadius: "50%",
            background: "#ff4d4f",
            border: "2px solid #fff",
            animation: "fabBadgeBounce 1.8s ease-in-out infinite",
            pointerEvents: "none",
          }} />
        )}

        <button
          style={fabStyle}
          onClick={() => setOpen((v) => !v)}
          title={open ? "Close AI Assistant" : "Open AI Assistant"}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        >
          {open
            ? <span style={{ color: "#1677ff", fontWeight: 700, fontSize: 18 }}>✕</span>
            : <span style={{ fontSize: 24 }}>🤖</span>
          }
        </button>
      </div>

      {/* ── Chat Panel ────────────────────────────────────────────────────── */}
      <div style={panelStyle}>

        {/* Header */}
        <div style={{
          padding:        "16px 18px",
          borderBottom:   "1px solid #f0f0f0",
          display:        "flex",
          alignItems:     "center",
          gap:            10,
          background:     "linear-gradient(135deg,#1677ff 0%,#4096ff 100%)",
        }}>
          <span style={{ fontSize: 22 }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>AI Assistant</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>AI-powered · natural language queries</div>
          </div>
          {loading && (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.8)",
                  animation: `bounce 1s ${i * 0.2}s infinite ease-in-out`,
                }} />
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth:     "85%",
                padding:      "10px 14px",
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background:   m.role === "user"  ? "#1677ff"
                            : m.role === "error" ? "#fff2f0"
                            : "#f5f5f5",
                color:        m.role === "user"  ? "#fff"
                            : m.role === "error" ? "#cf1322"
                            : "#262626",
                fontSize:     13.5,
                lineHeight:   1.5,
                border:       m.role === "error" ? "1px solid #ffccc7" : "none",
                wordBreak:    "break-word",
              }}>
                {m.text}
              </div>
              {m.actions && m.actions.length > 0 && (
                <div style={{
                  marginTop:    4,
                  fontSize:     11,
                  color:        "#8c8c8c",
                  maxWidth:     "85%",
                  padding:      "0 4px",
                  display:      "flex",
                  flexWrap:     "wrap",
                  gap:          4,
                }}>
                  {describeActions(m.actions).split(" · ").map((tag, i) => (
                    <span key={i} style={{
                      background: "#e6f0ff",
                      color:      "#1677ff",
                      borderRadius: 4,
                      padding:    "2px 6px",
                      fontSize:   11,
                      fontWeight: 500,
                    }}>
                      ✓ {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{ background: "#f5f5f5", borderRadius: "16px 16px 16px 4px", padding: "12px 16px", display: "flex", gap: 5 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    width: 7, height: 7, borderRadius: "50%", background: "#bfbfbf",
                    animation: `bounce 1s ${i * 0.2}s infinite ease-in-out`,
                  }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestion chips */}
        <div style={{ padding: "4px 14px 10px", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {visibleChips.map((s) => (
              <button
                key={s}
                onClick={() => sendChip(s)}
                style={{
                  padding:      "5px 10px",
                  borderRadius: 20,
                  border:       "1px solid #d9d9d9",
                  background:   "#fafafa",
                  fontSize:     11.5,
                  color:        "#595959",
                  cursor:       "pointer",
                  fontFamily:   "Inter, sans-serif",
                  transition:   "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#e6f0ff"; e.currentTarget.style.borderColor = "#1677ff"; e.currentTarget.style.color = "#1677ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fafafa"; e.currentTarget.style.borderColor = "#d9d9d9"; e.currentTarget.style.color = "#595959"; }}
              >
                {s}
              </button>
            ))}
          </div>

        {/* Input */}
        <div style={{
          padding:    "10px 12px 14px",
          borderTop:  "1px solid #f0f0f0",
          display:    "flex",
          gap:        8,
          background: "#fafafa",
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask about the dashboard data…"
            disabled={loading}
            style={{
              flex:         1,
              padding:      "9px 14px",
              borderRadius: 24,
              border:       "1px solid #d9d9d9",
              fontSize:     13.5,
              outline:      "none",
              fontFamily:   "Inter, sans-serif",
              background:   "#fff",
              color:        "#262626",
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            style={{
              width:        40,
              height:       40,
              borderRadius: "50%",
              border:       "none",
              background:   input.trim() && !loading ? "#1677ff" : "#d9d9d9",
              color:        "#fff",
              fontSize:     18,
              cursor:       input.trim() && !loading ? "pointer" : "default",
              display:      "flex",
              alignItems:   "center",
              justifyContent: "center",
              flexShrink:   0,
              transition:   "background 0.15s",
            }}
          >
            ➤
          </button>
        </div>
      </div>

      {/* Bounce keyframes injected once */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes fabPulse {
          0%   { transform: scale(1);   opacity: 1; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes fabLabelPop {
          0%   { opacity: 0; transform: translateY(-50%) translateX(6px); }
          100% { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
        @keyframes fabBadgeBounce {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.3); }
        }
      `}</style>
    </>
  );
}
