import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs"
export const maxDuration = 60; // Vercel max for Pro plan (adjust to 10 for Hobby)
export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

/**
 * Returns a configured Puppeteer browser instance.
 * Uses @sparticuz/chromium in production (Vercel/Lambda) and
 * the locally installed Chrome in development.
 */
async function getBrowser() {
  if (process.env.NODE_ENV === "production") {
    // Production: use the stripped-down chromium binary
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  } else {
    // Development: try to find a local Chrome/Chromium installation
    const puppeteer = (await import("puppeteer-core")).default;

    // Common Chrome paths by platform
    const possiblePaths: Record<string, string[]> = {
      darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ],
      linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
      ],
      win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ],
    };

    const { platform } = process;
    const paths = possiblePaths[platform] ?? [];

    // Allow overriding via env var
    const executablePath =
      process.env.CHROME_EXECUTABLE_PATH ?? paths[0] ?? "";

    return puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      executablePath,
      headless: true,
    });
  }
}

/**
 * Extracts chat messages from a Gemini shared conversation page.
 *
 * Gemini uses dynamically-generated class names, so we rely on
 * structural and semantic selectors that are more stable:
 *
 * User turns:   <user-query> or elements with data-role="user"
 *               or siblings/containers labeled with user content.
 * Model turns:  <model-response> or elements with role="presentation"
 *               that contain the assistant reply.
 *
 * We try multiple selector strategies and fall back gracefully.
 */
async function extractMessages(url: string): Promise<ChatMessage[]> {
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();

    // Set a realistic viewport and user-agent to avoid bot detection
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });

    // Wait for the conversation container to appear.
    // Try several candidate selectors (Gemini's DOM changes over time).
    const containerSelectors = [
      "conversation-container",
      "chat-history",
      "[data-response-index]",
      "message-content",
      ".conversation-container",
      "infinite-scroller",
    ];

    let found = false;
    for (const sel of containerSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 8_000 });
        found = true;
        break;
      } catch {
        // Try next selector
      }
    }

    // Extra wait for dynamic content to render even if we didn't find a selector
    await new Promise((r) => setTimeout(r, found ? 1500 : 4000));

    // Scroll to the bottom to trigger lazy loading of older messages
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract messages from the page DOM
    const messages = await page.evaluate((): ChatMessage[] => {
      const results: ChatMessage[] = [];

      // ── Strategy 1: Custom elements (most reliable) ──────────────
      // Gemini renders turns as custom elements: <user-query> and <model-response>
      const userNodes = Array.from(document.querySelectorAll("user-query"));
      const modelNodes = Array.from(document.querySelectorAll("model-response"));

      if (userNodes.length > 0 || modelNodes.length > 0) {
        // Gather all turn elements and sort by DOM order
        const allNodes: Array<{ el: Element; role: "user" | "model" }> = [
          ...userNodes.map((el) => ({ el, role: "user" as const })),
          ...modelNodes.map((el) => ({ el, role: "model" as const })),
        ];

        // Sort by DOM position using compareDocumentPosition
        allNodes.sort((a, b) =>
          a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1
        );

        for (const { el, role } of allNodes) {
          const text = el.textContent?.trim() ?? "";
          if (text) results.push({ role, content: text });
        }

        if (results.length > 0) return results;
      }

      // ── Strategy 2: data-role attributes ────────────────────────
      const roleNodes = Array.from(
        document.querySelectorAll("[data-role], [data-turn-role]")
      );

      if (roleNodes.length > 0) {
        for (const el of roleNodes) {
          const roleAttr =
            el.getAttribute("data-role") ??
            el.getAttribute("data-turn-role") ??
            "";
          const role = roleAttr.toLowerCase().includes("user") ? "user" : "model";
          const text = el.textContent?.trim() ?? "";
          if (text) results.push({ role, content: text });
        }

        if (results.length > 0) return results;
      }

      // ── Strategy 3: Structural heuristic ─────────────────────────
      // Look for a repeating pattern of sibling containers that
      // alternate or are labeled as human/assistant.
      const candidates = Array.from(
        document.querySelectorAll(
          [
            "[class*='human']",
            "[class*='user']",
            "[class*='model']",
            "[class*='assistant']",
            "[class*='response']",
            "[class*='query']",
            "[class*='message']",
            "[class*='turn']",
          ].join(",")
        )
      );

      // Deduplicate: keep elements that are not ancestors of each other
      const seen = new Set<Element>();
      const deduped: Element[] = [];
      for (const el of candidates) {
        let dominated = false;
        for (const kept of deduped) {
          if (kept.contains(el)) {
            dominated = true;
            break;
          }
        }
        if (!dominated && !seen.has(el)) {
          deduped.push(el);
          seen.add(el);
        }
      }

      for (const el of deduped) {
        const cls = (el.className ?? "").toLowerCase();
        const isUser =
          cls.includes("human") ||
          cls.includes("user") ||
          cls.includes("query");
        const isModel =
          cls.includes("model") ||
          cls.includes("assistant") ||
          cls.includes("response");

        if (!isUser && !isModel) continue;

        const text = el.textContent?.trim() ?? "";
        if (text.length > 3) {
          results.push({
            role: isUser ? "user" : "model",
            content: text,
          });
        }
      }

      return results;
    });

    return messages;
  } finally {
    await browser.close();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) {
      return NextResponse.json(
        { error: "Missing 'url' in request body" },
        { status: 400 }
      );
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Only allow Gemini share links
    const allowedHosts = ["gemini.google.com", "g.co"];
    if (!allowedHosts.some((h) => parsedUrl.hostname.endsWith(h))) {
      return NextResponse.json(
        {
          error:
            "Only Gemini share links (gemini.google.com) are supported",
        },
        { status: 400 }
      );
    }

    const messages = await extractMessages(url);

    if (messages.length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not extract conversation. The link may be private, expired, or the page structure has changed.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    console.error("[/api/extract] Error:", err);

    const message =
      err instanceof Error ? err.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
