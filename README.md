# Oil & Gas Well Monitoring Dashboard

A real-time interactive monitoring dashboard built with **React**, **TypeScript**, and **Highcharts** — designed to visualize oil & gas well sensor data with an AI-powered natural language query interface.

---

## Live Demo

> Run locally with `npm run dev` (see [Getting Started](#getting-started))

---

## Features

### 📊 Multi-Axis Chart
- Visualizes **5 sensor parameters** simultaneously on independent Y-axes
- Supports **Line**, **Spline**, **Area**, and **Column** chart types
- Per-parameter **min/max axis range** configuration via Settings popup

### ⚡ Live & History Modes
- **Live mode** — streams real-time data, appending new points every 10 seconds
- Time windows: **1 Hour**, **12 Hours**, **24 Hours**
- **History mode** — static snapshots for Yesterday, 1 Week, and 1 Month
- Custom date range picker

### 🧩 Interactive Legend
- Click any parameter in the legend bar to **show/hide** it on the chart
- Color-coded labels with unit display

### 🤖 AI Assistant (Natural Language Queries)
- Floating chat panel powered by a built-in NLP interpreter
- Ask questions like:
  - *"Show only pressure sensors"*
  - *"Switch to 1-week history"*
  - *"Use spline chart"*
  - *"Hide B-annulus pressure"*
- Smart suggestion chips that rotate so you never see the same query twice
- Works fully offline — no API key required (optional OpenAI integration available)

### ⚙️ Settings Panel
- Modal overlay on the chart
- Change **chart type** globally (line / spline / area / column)
- Set custom **Min / Max** range per parameter

### 📥 Export Options
- **Download PNG** — captures legend + chart as a single image
- **Download XLSX** — exports all visible data to Excel

---

## Parameters Monitored

| Parameter | Label | Unit |
|---|---|---|
| Tubing Pressure | TBG Press | PSI |
| A-Annulus Pressure | A-Ann Press | PSI |
| B-Annulus Pressure | B-Ann Press | PSI |
| Flowline Pressure | FL Press | PSI |
| Flowline Temperature | FL Temp | °F |

---

## Tech Stack

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite 6 | Build tool & dev server |
| Highcharts | Multi-axis charting |
| html2canvas | PNG export |
| SheetJS (xlsx) | Excel export |

---

## Getting Started

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/React_Dashboard.git
cd React_Dashboard
npm install
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
```

---

## Optional: OpenAI Integration

The AI Assistant works locally by default. To enable GPT-powered responses:

1. Create a `.env` file in the project root:
```
VITE_OPENAI_API_KEY=sk-...your-key-here...
```
2. Restart the dev server.

> The app automatically falls back to local NLP if the key is missing or over quota.

---

## Project Structure

```
src/
├── components/
│   ├── LiveChart.tsx   # Main dashboard component
│   └── AIChat.tsx      # AI chat panel with NLP interpreter
├── App.tsx
├── App.css
└── main.tsx
```

---

## Screenshots

> *(Add screenshots of your dashboard here)*

---

## License

MIT
