"use client";

import { useState, useRef } from "react";

export default function Home() {
  const [content, setContent] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [contentSource, setContentSource] = useState<"pdf" | "text" | "">(""); 
  const [fileName, setFileName] = useState("");
  const [revealedMC, setRevealedMC] = useState<number | null>(null);
  const [revealedSA, setRevealedSA] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function generate() {
    if (!content) return;
    setLoading(true);
    setResult(null);
    setRevealedMC(null);
    setRevealedSA(null);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    const data = await res.json();
    setResult(data.result || data.error);
    setLoading(false);
  }

  async function processFile(file: File) {
    if (!file.type.includes("pdf")) {
      setUploadError("Please upload a PDF file.");
      return;
    }

    setUploading(true);
    setResult(null);
    setUploadError("");
    setContent("");
    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.text) {
        setUploadError(data.error || "Failed to extract text from PDF");
        setContent("");
        setContentSource("");
        setFileName("");
      } else {
        setContent(data.text);
        setContentSource("pdf");
        setUploadError("");
      }
    } catch (error) {
      setUploadError("Error uploading PDF. Please try again.");
      setContent("");
      setContentSource("");
      setFileName("");
    }

    setUploading(false);
  }

  async function handlePDFUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function clearContent() {
    setContent("");
    setContentSource("");
    setFileName("");
    setUploadError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');

        * { box-sizing: border-box; }

        body {
          margin: 0;
          background: #F7F5F0;
          font-family: 'DM Sans', sans-serif;
          color: #1a1a1a;
        }

        .serif { font-family: 'Instrument Serif', serif; }

        .page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 64px 24px 96px;
        }

        .container {
          width: 100%;
          max-width: 680px;
        }

        /* Header */
        .header {
          text-align: center;
          margin-bottom: 56px;
        }

        .logo {
          font-family: 'Instrument Serif', serif;
          font-size: 72px;
          line-height: 1;
          letter-spacing: -2px;
          color: #1a1a1a;
          margin: 0 0 4px;
        }

        .logo em {
          font-style: italic;
          color: #5B6AF0;
        }

        .tagline {
          font-size: 15px;
          color: #888;
          font-weight: 400;
          letter-spacing: 0.01em;
        }

        /* Card */
        .card {
          background: #fff;
          border-radius: 20px;
          border: 1px solid #E8E4DD;
          padding: 32px;
          margin-bottom: 12px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.04);
        }

        /* Drop zone */
        .dropzone {
          border: 1.5px dashed #D0CAC0;
          border-radius: 14px;
          padding: 28px 24px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: #FAFAF8;
          margin-bottom: 20px;
          position: relative;
        }

        .dropzone:hover, .dropzone.active {
          border-color: #5B6AF0;
          background: #F5F5FF;
        }

        .dropzone input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
        }

        .dropzone-icon {
          width: 40px;
          height: 40px;
          background: #F0EFFF;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 12px;
        }

        .dropzone-title {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          margin: 0 0 4px;
        }

        .dropzone-sub {
          font-size: 13px;
          color: #999;
          margin: 0;
        }

        /* Divider */
        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }

        .divider-line {
          flex: 1;
          height: 1px;
          background: #E8E4DD;
        }

        .divider-text {
          font-size: 12px;
          color: #BBB;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        /* Textarea */
        .textarea {
          width: 100%;
          height: 200px;
          border: 1.5px solid #E8E4DD;
          border-radius: 12px;
          padding: 16px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: #1a1a1a;
          background: #FAFAF8;
          resize: none;
          transition: border-color 0.2s;
          outline: none;
          margin-bottom: 16px;
        }

        .textarea::placeholder { color: #BBB; }

        .textarea:focus {
          border-color: #5B6AF0;
          background: #fff;
        }

        /* Status pills */
        .status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 16px;
        }

        .status.success {
          background: #F0FDF4;
          border: 1px solid #BBF7D0;
          color: #166534;
        }

        .status.error {
          background: #FFF5F5;
          border: 1px solid #FED7D7;
          color: #9B2C2C;
        }

        .status.loading-status {
          background: #F5F5FF;
          border: 1px solid #C7D2FE;
          color: #3730A3;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .status.success .status-dot { background: #22C55E; }
        .status.error .status-dot { background: #EF4444; }

        .status-clear {
          margin-left: auto;
          background: none;
          border: none;
          cursor: pointer;
          color: #166534;
          font-size: 16px;
          line-height: 1;
          padding: 0;
          opacity: 0.6;
        }

        .status-clear:hover { opacity: 1; }

        /* Spinner */
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* Button */
        .btn {
          width: 100%;
          padding: 14px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .btn-primary {
          background: #1a1a1a;
          color: #fff;
        }

        .btn-primary:hover:not(:disabled) {
          background: #333;
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(0,0,0,0.15);
        }

        .btn-primary:active:not(:disabled) {
          transform: translateY(0);
        }

        .btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* Results */
        .results-card {
          background: #fff;
          border-radius: 20px;
          border: 1px solid #E8E4DD;
          overflow: hidden;
          box-shadow: 0 2px 16px rgba(0,0,0,0.04);
        }

        .results-header {
          padding: 28px 32px 24px;
          border-bottom: 1px solid #F0EDE8;
        }

        .results-title {
          font-family: 'Instrument Serif', serif;
          font-size: 26px;
          letter-spacing: -0.5px;
          color: #1a1a1a;
          margin: 0 0 4px;
        }

        .results-meta {
          font-size: 13px;
          color: #999;
        }

        .section {
          padding: 28px 32px;
          border-bottom: 1px solid #F0EDE8;
        }

        .section:last-child { border-bottom: none; }

        .section-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #BBB;
          margin: 0 0 20px;
        }

        .question-block {
          padding: 20px 0;
          border-bottom: 1px solid #F7F5F0;
        }

        .question-block:last-child { border-bottom: none; padding-bottom: 0; }
        .question-block:first-child { padding-top: 0; }

        .question-num {
          font-family: 'Instrument Serif', serif;
          font-size: 13px;
          font-style: italic;
          color: #5B6AF0;
          margin-bottom: 6px;
        }

        .question-text {
          font-size: 15px;
          font-weight: 500;
          color: #1a1a1a;
          line-height: 1.5;
          margin: 0 0 14px;
        }

        .options {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 14px;
        }

        .option {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #FAFAF8;
          border: 1px solid #EDE9E2;
          font-size: 13.5px;
          color: #444;
          transition: background 0.15s;
        }

        .option:hover { background: #F3F0EB; }

        .option-letter {
          font-size: 12px;
          font-weight: 600;
          color: #BBB;
          flex-shrink: 0;
          padding-top: 1px;
          min-width: 16px;
        }

        .reveal-btn {
          background: none;
          border: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #5B6AF0;
          cursor: pointer;
          padding: 0;
          transition: color 0.15s;
        }

        .reveal-btn:hover { color: #3D4FD4; }

        .answer-box {
          margin-top: 10px;
          padding: 12px 14px;
          border-radius: 8px;
          background: #F0FDF4;
          border: 1px solid #BBF7D0;
          font-size: 13.5px;
          color: #166534;
          line-height: 1.55;
        }

        .answer-label {
          font-weight: 700;
          margin-right: 4px;
        }

        /* File loaded chip */
        .file-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: #F0EFFF;
          border: 1px solid #C7D2FE;
          border-radius: 8px;
          font-size: 12.5px;
          color: #3730A3;
          font-weight: 500;
        }
      `}</style>

      <main className="page">
        <div className="container">

          {/* Header */}
          <div className="header">
            <h1 className="logo">Stad<em>e</em></h1>
            <p className="tagline">Turn your notes into exam-ready questions, instantly.</p>
          </div>

          {/* Input Card */}
          <div className="card">

            {/* Drop Zone */}
            <div
              className={`dropzone${dragOver ? " active" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handlePDFUpload}
                style={{ display: "none" }}
              />
              <div className="dropzone-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5B6AF0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </div>
              <p className="dropzone-title">Drop a PDF here or click to browse</p>
              <p className="dropzone-sub">Lecture notes, textbooks, study guides</p>
            </div>

            {/* Statuses */}
            {uploading && (
              <div className="status loading-status">
                <div className="spinner"></div>
                Extracting text from PDF…
              </div>
            )}

            {uploadError && !uploading && (
              <div className="status error">
                <span className="status-dot"></span>
                {uploadError}
              </div>
            )}

            {content && contentSource === "pdf" && !uploading && (
              <div className="status success">
                <span className="status-dot"></span>
                <span className="file-chip" style={{ background: "none", border: "none", padding: 0, color: "inherit" }}>
                  📄 {fileName} · {(content.length / 1000).toFixed(1)}k chars
                </span>
                <button className="status-clear" onClick={clearContent}>✕</button>
              </div>
            )}

            {/* Divider */}
            <div className="divider">
              <div className="divider-line"></div>
              <span className="divider-text">or paste text</span>
              <div className="divider-line"></div>
            </div>

            {/* Textarea */}
            <textarea
              className="textarea"
              placeholder="Paste lecture notes, textbook excerpts, or any study material…"
              value={contentSource === "pdf" ? "" : content}
              onChange={(e) => {
                if (contentSource === "pdf") return;
                setContent(e.target.value);
                setContentSource(e.target.value ? "text" : "");
              }}
              disabled={contentSource === "pdf"}
              style={contentSource === "pdf" ? { opacity: 0.4, cursor: "not-allowed" } : {}}
            />

            {/* Generate Button */}
            <button
              className="btn btn-primary"
              onClick={generate}
              disabled={loading || !content || uploading}
            >
              {loading ? (
                <>
                  <div className="spinner"></div>
                  Generating questions…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                  Generate Study Questions
                </>
              )}
            </button>
          </div>

          {/* Results */}
          {result && typeof result === "object" && (
            <div className="results-card" style={{ marginTop: 28 }}>
              <div className="results-header">
                <h2 className="results-title">Your Study Questions</h2>
                <p className="results-meta">
                  {result.multiple_choice?.length || 0} multiple choice &nbsp;·&nbsp; {result.short_answer?.length || 0} short answer
                </p>
              </div>

              {/* Multiple Choice */}
              {result.multiple_choice?.length > 0 && (
                <div className="section">
                  <p className="section-label">Multiple Choice</p>
                  {result.multiple_choice.map((q: any, i: number) => (
                    <div key={i} className="question-block">
                      <p className="question-num">Question {i + 1}</p>
                      <p className="question-text">{q.question}</p>
                      <div className="options">
                        {q.options.map((opt: string, idx: number) => (
                          <div key={idx} className="option">
                            <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                            <span>{opt}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        className="reveal-btn"
                        onClick={() => setRevealedMC(revealedMC === i ? null : i)}
                      >
                        {revealedMC === i ? "Hide answer" : "Reveal answer"}
                      </button>
                      {revealedMC === i && (
                        <div className="answer-box">
                          <span className="answer-label">✓</span>{q.answer}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Short Answer */}
              {result.short_answer?.length > 0 && (
                <div className="section">
                  <p className="section-label">Short Answer</p>
                  {result.short_answer.map((q: any, i: number) => (
                    <div key={i} className="question-block">
                      <p className="question-num">Question {i + 1}</p>
                      <p className="question-text">{q.question}</p>
                      <button
                        className="reveal-btn"
                        onClick={() => setRevealedSA(revealedSA === i ? null : i)}
                      >
                        {revealedSA === i ? "Hide answer" : "Reveal answer"}
                      </button>
                      {revealedSA === i && (
                        <div className="answer-box">{q.answer}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </>
  );
}