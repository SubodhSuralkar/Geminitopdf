"use client";

import { useState, useRef } from "react";
import styles from "./page.module.css";

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

type Status = "idle" | "fetching" | "success" | "error" | "generating";

export default function Home() {
  const [url, setUrl] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [pdfProgress, setPdfProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFetch = async () => {
    if (!url.trim()) {
      inputRef.current?.focus();
      return;
    }

    setStatus("fetching");
    setMessages([]);
    setErrorMsg("");

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to extract conversation");
      }

      if (!data.messages || data.messages.length === 0) {
        throw new Error("No conversation content found at this URL");
      }

      setMessages(data.messages);
      setStatus("success");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  const handleDownloadPDF = async () => {
    if (messages.length === 0) return;

    setStatus("generating");
    setPdfProgress(0);

    try {
      // Dynamically import jsPDF only on client
      const { jsPDF } = await import("jspdf");

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const marginLeft = 18;
      const marginRight = 18;
      const marginTop = 22;
      const marginBottom = 22;
      const contentWidth = pageWidth - marginLeft - marginRight;

      let y = marginTop;

      // ── Helper: add new page ──────────────────────────────────────
      const addPage = () => {
        doc.addPage();
        y = marginTop;
        drawPageDecorations();
      };

      // ── Page decorations (header rule + page number) ──────────────
      const drawPageDecorations = () => {
        const pageNum = doc.getNumberOfPages();

        // Thin top rule
        doc.setDrawColor(180, 170, 160);
        doc.setLineWidth(0.3);
        doc.line(marginLeft, 14, pageWidth - marginRight, 14);

        // Page number
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(140, 130, 120);
        doc.text(`${pageNum}`, pageWidth / 2, 11, { align: "center" });

        // Footer rule
        doc.line(marginLeft, pageHeight - 14, pageWidth - marginRight, pageHeight - 14);
        doc.text("Gemini Conversation Export", pageWidth / 2, pageHeight - 10, { align: "center" });
      };

      // ── Cover page ────────────────────────────────────────────────
      // Background rect at top
      doc.setFillColor(15, 14, 13);
      doc.rect(0, 0, pageWidth, 90, "F");

      // Accent line
      doc.setFillColor(201, 79, 42);
      doc.rect(0, 88, pageWidth, 2, "F");

      // Title
      doc.setFont("times", "bold");
      doc.setFontSize(34);
      doc.setTextColor(245, 240, 232);
      doc.text("Gemini", marginLeft, 44);
      doc.setFont("times", "italic");
      doc.setFontSize(28);
      doc.setTextColor(201, 79, 42);
      doc.text("Conversation", marginLeft, 58);

      // Subtitle
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(138, 127, 114);
      doc.text("Exported with gemini-pdf", marginLeft, 72);

      // URL box
      doc.setFillColor(237, 232, 220);
      doc.roundedRect(marginLeft, 100, contentWidth, 16, 2, 2, "F");
      doc.setFont("courier", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(80, 70, 60);
      const urlDisplay = url.length > 75 ? url.slice(0, 72) + "…" : url;
      doc.text(urlDisplay, marginLeft + 4, 110);

      // Stats
      const userCount = messages.filter((m) => m.role === "user").length;
      const modelCount = messages.filter((m) => m.role === "model").length;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 90, 80);
      doc.text(
        `${messages.length} messages  ·  ${userCount} prompts  ·  ${modelCount} responses`,
        marginLeft,
        130
      );

      // Date
      const now = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      doc.setFontSize(8);
      doc.setTextColor(140, 130, 120);
      doc.text(now, marginLeft, 140);

      // Divider
      doc.setDrawColor(212, 205, 194);
      doc.setLineWidth(0.3);
      doc.line(marginLeft, 148, pageWidth - marginRight, 148);

      // "Table of turns" intro
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(60, 55, 50);
      doc.text("CONTENTS", marginLeft, 158);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 90, 80);
      messages.slice(0, 12).forEach((msg, i) => {
        const label = msg.role === "user" ? "Q" : "A";
        const preview = msg.content.slice(0, 60).replace(/\n/g, " ") + (msg.content.length > 60 ? "…" : "");
        doc.setFont("helvetica", "bold");
        doc.setTextColor(msg.role === "user" ? 201 : 80, msg.role === "user" ? 79 : 70, msg.role === "user" ? 42 : 60);
        doc.text(label, marginLeft, 166 + i * 7.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(80, 70, 60);
        doc.text(preview, marginLeft + 6, 166 + i * 7.5);
      });

      if (messages.length > 12) {
        doc.setTextColor(140, 130, 120);
        doc.text(`… and ${messages.length - 12} more`, marginLeft, 166 + 12 * 7.5);
      }

      // ── Content pages ─────────────────────────────────────────────
      doc.addPage();
      drawPageDecorations();
      y = marginTop;

      messages.forEach((msg, idx) => {
        setPdfProgress(Math.round(((idx + 1) / messages.length) * 100));
        const isUser = msg.role === "user";

        // Estimate needed height
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        const lines = doc.splitTextToSize(msg.content, contentWidth - 10);
        const blockHeight = 6 + 5 + lines.length * 5.2 + 8;

        if (y + blockHeight > pageHeight - marginBottom) {
          addPage();
        }

        // Label pill
        const labelText = isUser ? "YOU" : "GEMINI";
        const labelColor = isUser ? [201, 79, 42] : [40, 120, 80];

        doc.setFillColor(...(labelColor as [number, number, number]));
        doc.roundedRect(marginLeft, y, isUser ? 22 : 28, 5.5, 1, 1, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6);
        doc.setTextColor(255, 255, 255);
        doc.text(labelText, marginLeft + (isUser ? 11 : 14), y + 3.8, { align: "center" });

        // Turn number
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(160, 150, 140);
        doc.text(`#${idx + 1}`, pageWidth - marginRight, y + 3.8, { align: "right" });

        y += 8;

        // Message background
        const bgColor: [number, number, number] = isUser ? [26, 23, 20] : [255, 255, 255];
        const borderColor: [number, number, number] = isUser ? [60, 50, 40] : [212, 205, 194];

        doc.setFillColor(...bgColor);
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.25);
        doc.roundedRect(marginLeft, y, contentWidth, lines.length * 5.2 + 8, 2, 2, "FD");

        // Message text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(isUser ? 235 : 30, isUser ? 228 : 25, isUser ? 215 : 20);
        doc.text(lines, marginLeft + 5, y + 5.5, { lineHeightFactor: 1.45 });

        y += lines.length * 5.2 + 8;
        y += 6; // gap between messages
      });

      // ── Save ──────────────────────────────────────────────────────
      doc.save("gemini-conversation.pdf");
      setStatus("success");
      setPdfProgress(0);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "PDF generation failed");
      setStatus("error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleFetch();
  };

  const wordCount = messages.reduce((acc, m) => acc + m.content.split(/\s+/).length, 0);

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoGemini}>Gemini</span>
            <span className={styles.logoArrow}>→</span>
            <span className={styles.logoPdf}>PDF</span>
          </div>
          <p className={styles.tagline}>
            Archive your AI conversations as beautiful, shareable documents
          </p>
        </div>
        <div className={styles.headerRule} />
      </header>

      {/* Hero section */}
      <section className={styles.hero}>
        <div className={styles.heroNumber}>01</div>
        <h2 className={styles.heroTitle}>Paste your Gemini link</h2>
        <p className={styles.heroSub}>
          Share a Gemini conversation, copy the link, paste it below.
        </p>

        <div className={styles.inputRow}>
          <div className={styles.inputWrap}>
            <span className={styles.inputIcon}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </span>
            <input
              ref={inputRef}
              type="url"
              className={styles.input}
              placeholder="https://gemini.google.com/share/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={status === "fetching" || status === "generating"}
            />
          </div>
          <button
            className={`${styles.btnFetch} ${status === "fetching" ? styles.btnLoading : ""}`}
            onClick={handleFetch}
            disabled={status === "fetching" || status === "generating"}
          >
            {status === "fetching" ? (
              <><span className={styles.spinner} /> Fetching…</>
            ) : "Fetch"}
          </button>
        </div>

        {status === "error" && (
          <div className={styles.errorBanner}>
            <span className={styles.errorIcon}>!</span>
            {errorMsg}
          </div>
        )}
      </section>

      {/* Preview section */}
      {messages.length > 0 && (
        <section className={styles.preview}>
          <div className={styles.previewHeader}>
            <div className={styles.previewMeta}>
              <div className={styles.heroNumber}>02</div>
              <div>
                <h2 className={styles.heroTitle}>Conversation preview</h2>
                <div className={styles.stats}>
                  <span className={styles.stat}>{messages.length} messages</span>
                  <span className={styles.statDot}>·</span>
                  <span className={styles.stat}>{messages.filter(m => m.role === "user").length} prompts</span>
                  <span className={styles.statDot}>·</span>
                  <span className={styles.stat}>{wordCount.toLocaleString()} words</span>
                </div>
              </div>
            </div>

            <button
              className={`${styles.btnDownload} ${status === "generating" ? styles.btnLoading : ""}`}
              onClick={handleDownloadPDF}
              disabled={status === "generating"}
            >
              {status === "generating" ? (
                <><span className={styles.spinner} /> Generating… {pdfProgress > 0 ? `${pdfProgress}%` : ""}</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download PDF
                </>
              )}
            </button>
          </div>

          <div className={styles.chatFeed}>
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`${styles.bubble} ${msg.role === "user" ? styles.bubbleUser : styles.bubbleModel}`}
              >
                <div className={styles.bubbleLabel}>
                  <span className={`${styles.rolePill} ${msg.role === "user" ? styles.rolePillUser : styles.rolePillModel}`}>
                    {msg.role === "user" ? "You" : "Gemini"}
                  </span>
                  <span className={styles.turnNum}>#{i + 1}</span>
                </div>
                <p className={styles.bubbleContent}>{msg.content}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      {status === "idle" && (
        <section className={styles.how}>
          <div className={styles.howGrid}>
            {[
              { n: "1", title: "Share your chat", body: "Open any Gemini conversation and click Share → Copy link." },
              { n: "2", title: "Extract", body: "Our headless browser visits the link and parses every turn." },
              { n: "3", title: "Download", body: "jsPDF renders a clean, paginated document you can keep forever." },
            ].map((step) => (
              <div key={step.n} className={styles.howStep}>
                <span className={styles.howNum}>{step.n}</span>
                <h3 className={styles.howTitle}>{step.title}</h3>
                <p className={styles.howBody}>{step.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <span>Built with Next.js · Puppeteer · jsPDF</span>
      </footer>
    </main>
  );
}
