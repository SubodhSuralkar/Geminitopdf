# Gemini → PDF

Convert Google Gemini shared conversation links into clean, paginated PDFs.

## Features

- **Headless extraction** — Puppeteer visits the Gemini share URL and parses every user prompt and model response
- **Multi-strategy DOM parsing** — targets `<user-query>` / `<model-response>` custom elements first, then falls back to `data-role` attributes and class-name heuristics
- **Beautiful PDF output** — cover page with metadata, alternating dark/light chat bubbles, page numbers, and a table of contents preview
- **Vercel-ready** — uses `@sparticuz/chromium` in production and your local Chrome in development
- **Editorial UI** — warm paper-toned design with DM Serif Display typography

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set Chrome path (local dev only)

The app auto-detects Chrome on macOS, Linux, and Windows. If detection fails, set:

```bash
cp .env.example .env.local
# then edit .env.local:
CHROME_EXECUTABLE_PATH=/path/to/your/chrome
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How It Works

```
User pastes Gemini share link
        │
        ▼
POST /api/extract
        │
        ├── getBrowser()
        │     ├── production → @sparticuz/chromium binary
        │     └── development → local Chrome
        │
        ├── page.goto(url, { waitUntil: 'networkidle2' })
        │
        ├── waitForSelector (tries 6 candidate selectors)
        │
        ├── scroll to bottom (trigger lazy-load)
        │
        └── page.evaluate() — 3-strategy extraction:
              1. <user-query> / <model-response> custom elements
              2. [data-role] / [data-turn-role] attributes
              3. Class-name heuristics (human/user/model/assistant)
        │
        ▼
JSON: { messages: [{ role, content }] }
        │
        ▼
Frontend (jsPDF)
        │
        ├── Cover page (dark header, URL, stats, TOC preview)
        └── Content pages (labeled bubbles, paginated, page numbers)
```

---

## Project Structure

```
gemini-pdf/
├── app/
│   ├── api/
│   │   └── extract/
│   │       └── route.ts     ← Puppeteer extraction API
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.module.css
│   └── page.tsx             ← UI + jsPDF generation
├── .env.example
├── next.config.js
├── package.json
├── tsconfig.json
└── vercel.json
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not extract conversation" | The link may be private/expired. Ensure it's a public share link. |
| Chrome not found (local) | Set `CHROME_EXECUTABLE_PATH` in `.env.local` |
| Timeout on Vercel Hobby | Upgrade to Pro or set `maxDuration: 10` and accept limitations |
| Empty PDF | Gemini updated its DOM — open an issue with the share URL structure |

---

## Tech Stack

- [Next.js 14](https://nextjs.org/) (App Router)
- [Puppeteer Core](https://pptr.dev/) + [@sparticuz/chromium](https://github.com/Sparticuz/chromium)
- [jsPDF](https://github.com/parallax/jsPDF)
- TypeScript
