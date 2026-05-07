import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

async function getBrowser() {
  try {
    console.log("[getBrowser] Loading chromium...");
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    const executablePath = await chromium.executablePath();
    console.log("[getBrowser] executablePath:", executablePath);

    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
    });

    console.log("[getBrowser] Browser launched");
    return browser;
  } catch (err) {
    console.error("[getBrowser] Failed:", err);
    throw err;
  }
}

async function extractMessages(url: string): Promise<ChatMessage[]> {
  console.log("[extractMessages] URL:", url);
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    console.log("[extractMessages] Navigating...");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    console.log("[extractMessages] Page loaded:", await page.title());

    // Try to wait for known selectors
    const selectors = ["user-query", "model-response", "conversation-container", "infinite-scroller", "[data-response-index]"];
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 6_000 });
        console.log("[extractMessages] Found selector:", sel);
        break;
      } catch { /* continue */ }
    }

    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 2000));

    // Log DOM info for debugging
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      userQueries: document.querySelectorAll("user-query").length,
      modelResponses: document.querySelectorAll("model-response").length,
      bodyLen: document.body.innerText.length,
    }));
    console.log("[extractMessages] DOM info:", JSON.stringify(info));

    const messages: ChatMessage[] = await page.evaluate(() => {
      const results: { role: "user" | "model"; content: string }[] = [];

      // Strategy 1: custom elements
      const userNodes = Array.from(document.querySelectorAll("user-query"));
      const modelNodes = Array.from(document.querySelectorAll("model-response"));

      if (userNodes.length > 0 || modelNodes.length > 0) {
        const all = [
          ...userNodes.map((el) => ({ el, role: "user" as const })),
          ...modelNodes.map((el) => ({ el, role: "model" as const })),
        ].sort((a, b) =>
          a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        );
        for (const { el, role } of all) {
          const text = el.textContent?.trim() ?? "";
          if (text) results.push({ role, content: text });
        }
        if (results.length) return results;
      }

      // Strategy 2: data-role
      for (const el of document.querySelectorAll("[data-role],[data-turn-role]")) {
        const r = (el.getAttribute("data-role") ?? el.getAttribute("data-turn-role") ?? "").toLowerCase();
        const text = el.textContent?.trim() ?? "";
        if (text) results.push({ role: r.includes("user") ? "user" : "model", content: text });
      }
      if (results.length) return results;

      // Strategy 3: class heuristics
      const els = Array.from(document.querySelectorAll(
        "[class*='human'],[class*='user-'],[class*='-user'],[class*='model'],[class*='assistant'],[class*='response'],[class*='query'],[class*='turn']"
      ));
      const seen = new Set<Element>();
      for (const el of els) {
        let skip = false;
        for (const kept of seen) { if (kept.contains(el)) { skip = true; break; } }
        if (skip) continue;
        const cls = (el.className ?? "").toLowerCase();
        const isUser = cls.includes("human") || cls.includes("user") || cls.includes("query");
        const isModel = cls.includes("model") || cls.includes("assistant") || cls.includes("response");
        if (!isUser && !isModel) continue;
        const text = el.textContent?.trim() ?? "";
        if (text.length > 3) {
          results.push({ role: isUser ? "user" : "model", content: text });
          seen.add(el);
        }
      }

      return results;
    });

    console.log("[extractMessages] Got", messages.length, "messages");
    return messages;
  } finally {
    await browser.close();
  }
}

export async function POST(request: NextRequest) {
  console.log("[POST /api/extract] Received");
  try {
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    let parsedUrl: URL;
    try { parsedUrl = new URL(url); }
    catch { return NextResponse.json({ error: "Invalid URL" }, { status: 400 }); }

    if (!["gemini.google.com", "g.co"].some((h) => parsedUrl.hostname.endsWith(h))) {
      return NextResponse.json({ error: "Only gemini.google.com or g.co links are supported" }, { status: 400 });
    }

    const messages = await extractMessages(url);

    if (!messages.length) {
      return NextResponse.json(
        { error: "No content found. The link may be private, expired, or Gemini updated its page structure." },
        { status: 422 }
      );
    }

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/extract] Error:", msg);
    console.error(err instanceof Error ? err.stack : "");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
