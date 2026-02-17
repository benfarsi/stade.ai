"use client";

import { useState, useRef } from "react";

type MCQuestion = { question: string; options: string[]; answer: string };
type SAQuestion = { question: string; answer: string };
type Questions = { multiple_choice: MCQuestion[]; short_answer: SAQuestion[] };
type Summary = { title: string; overview: string; key_points: string[]; concepts: { term: string; definition: string }[]; quick_facts: string[] };
type MCState = { selected: string | null; locked: boolean };
type SAState = { revealed: boolean; graded: "correct" | "wrong" | null };
type Tab = "summary" | "quiz";

export default function Home() {
  const [content, setContent] = useState("");
  const [contentSource, setContentSource] = useState<"pdf" | "text" | "">(""); 
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [questions, setQuestions] = useState<Questions | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const [mcStates, setMcStates] = useState<MCState[]>([]);
  const [saStates, setSaStates] = useState<SAState[]>([]);
  const [quizDone, setQuizDone] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const mcScore = mcStates.filter((s, i) => s.locked && questions?.multiple_choice[i] && s.selected === questions.multiple_choice[i].answer).length;
  const saScore = saStates.filter(s => s.graded === "correct").length;
  const totalScore = mcScore + saScore;
  const totalQ = (questions?.multiple_choice?.length || 0) + (questions?.short_answer?.length || 0);
  const totalAnswered = mcStates.filter(s => s.locked).length + saStates.filter(s => s.graded !== null).length;

  async function generateAll() {
    if (!content) return;
    setLoadingSummary(true);
    setLoadingQuiz(true);
    setSummary(null);
    setQuestions(null);
    setHasGenerated(false);
    setQuizDone(false);

    // Fire both requests in parallel
    const [sumRes, qRes] = await Promise.all([
      fetch("/api/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }),
      fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }),
    ]);

    const [sumData, qData] = await Promise.all([sumRes.json(), qRes.json()]);

    if (sumData.summary) setSummary(sumData.summary);
    setLoadingSummary(false);

    if (qData.result) {
      const q: Questions = qData.result;
      setQuestions(q);
      setMcStates(q.multiple_choice.map(() => ({ selected: null, locked: false })));
      setSaStates(q.short_answer.map(() => ({ revealed: false, graded: null })));
    }
    setLoadingQuiz(false);
    setHasGenerated(true);
    setTab("summary");
  }

  async function processFile(file: File) {
    if (!file.type.includes("pdf")) { setUploadError("Please upload a PDF file."); return; }
    setUploading(true); setSummary(null); setQuestions(null); setHasGenerated(false);
    setUploadError(""); setContent(""); setFileName(file.name);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.text) { setUploadError(data.error || "Failed to extract text"); setContentSource(""); setFileName(""); }
      else { setContent(data.text); setContentSource("pdf"); }
    } catch { setUploadError("Error uploading PDF."); setContentSource(""); setFileName(""); }
    setUploading(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function clearAll() {
    setContent(""); setContentSource(""); setFileName(""); setUploadError("");
    setSummary(null); setQuestions(null); setHasGenerated(false); setQuizDone(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function checkAllDone(newMc: MCState[], newSa: SAState[]) {
    if (newMc.every(s => s.locked) && newSa.every(s => s.graded !== null)) setQuizDone(true);
  }

  function selectMC(qi: number, opt: string) {
    if (mcStates[qi]?.locked) return;
    const newMc = mcStates.map((s, i) => i === qi ? { selected: opt, locked: true } : s);
    setMcStates(newMc); checkAllDone(newMc, saStates);
  }

  function revealSA(qi: number) {
    setSaStates(prev => prev.map((s, i) => i === qi ? { ...s, revealed: true } : s));
  }

  function gradeSA(qi: number, grade: "correct" | "wrong") {
    const newSa = saStates.map((s, i) => i === qi ? { ...s, graded: grade } : s);
    setSaStates(newSa); checkAllDone(mcStates, newSa);
  }

  function resetQuiz() {
    if (!questions) return;
    setMcStates(questions.multiple_choice.map(() => ({ selected: null, locked: false })));
    setSaStates(questions.short_answer.map(() => ({ revealed: false, graded: null })));
    setQuizDone(false);
  }

  const isLoading = loadingSummary || loadingQuiz;
  const scoreEmoji = totalScore === totalQ ? "🏆" : totalScore >= totalQ * 0.7 ? "🎯" : totalScore >= totalQ * 0.4 ? "📚" : "💪";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #F7F5F0; font-family: 'DM Sans', sans-serif; color: #1a1a1a; }
        .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 56px 24px 96px; }
        .container { width: 100%; max-width: 680px; }
        .header { text-align: center; margin-bottom: 44px; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 64px; line-height: 1; letter-spacing: -2px; color: #1a1a1a; }
        .logo em { font-style: italic; color: #5B6AF0; }
        .tagline { font-size: 15px; color: #999; margin-top: 6px; }
        .card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; padding: 28px; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }
        .dropzone { border: 1.5px dashed #D0CAC0; border-radius: 14px; padding: 24px; text-align: center; cursor: pointer; transition: all 0.2s; background: #FAFAF8; margin-bottom: 18px; }
        .dropzone:hover, .dropzone.active { border-color: #5B6AF0; background: #F5F5FF; }
        .dz-icon { width: 40px; height: 40px; background: #EEECFF; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; }
        .dz-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 3px; }
        .dz-sub { font-size: 13px; color: #aaa; }
        .divider { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .divider-line { flex: 1; height: 1px; background: #EDE9E2; }
        .divider-text { font-size: 11px; color: #C0BAB0; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
        textarea { width: 100%; height: 160px; border: 1.5px solid #E8E4DD; border-radius: 12px; padding: 14px; font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; background: #FAFAF8; resize: none; outline: none; margin-bottom: 14px; transition: border-color 0.2s; }
        textarea::placeholder { color: #C0BAB0; }
        textarea:focus { border-color: #5B6AF0; background: #fff; }
        textarea:disabled { opacity: 0.45; cursor: not-allowed; }
        .status { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 500; margin-bottom: 14px; }
        .status.success { background: #F0FDF4; border: 1px solid #BBF7D0; color: #166534; }
        .status.error { background: #FFF5F5; border: 1px solid #FED7D7; color: #9B2C2C; }
        .status.info { background: #F5F5FF; border: 1px solid #C7D2FE; color: #3730A3; }
        .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .status.success .status-dot { background: #22C55E; }
        .status.error .status-dot { background: #EF4444; }
        .x-btn { margin-left: auto; background: none; border: none; cursor: pointer; font-size: 15px; opacity: 0.4; padding: 0; line-height: 1; color: inherit; }
        .x-btn:hover { opacity: 1; }
        .spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn { width: 100%; padding: 13px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600; border: none; border-radius: 12px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .btn-primary { background: #1a1a1a; color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #2d2d2d; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.15); }
        .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Results layout */
        .results { margin-top: 20px; }
        .tabs { display: flex; background: #F0EDE8; border-radius: 12px; padding: 3px; margin-bottom: 16px; }
        .tab-btn { flex: 1; padding: 9px; border: none; border-radius: 9px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; background: none; color: #888; }
        .tab-btn.active { background: #fff; color: #1a1a1a; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .tab-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Summary */
        .sum-card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; overflow: hidden; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }
        .sum-hero { padding: 28px; border-bottom: 1px solid #F0EDE8; }
        .sum-title { font-family: 'Instrument Serif', serif; font-size: 28px; letter-spacing: -0.5px; color: #1a1a1a; margin-bottom: 10px; line-height: 1.2; }
        .sum-overview { font-size: 14.5px; line-height: 1.7; color: #555; }
        .sum-section { padding: 22px 28px; border-bottom: 1px solid #F5F2ED; }
        .sum-section:last-child { border-bottom: none; }
        .sum-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #C0BAB0; margin-bottom: 14px; }
        .key-point { display: flex; gap: 10px; margin-bottom: 10px; font-size: 14px; line-height: 1.55; color: #333; }
        .key-point:last-child { margin-bottom: 0; }
        .kp-dot { width: 6px; height: 6px; border-radius: 50%; background: #5B6AF0; flex-shrink: 0; margin-top: 7px; }
        .concept { padding: 12px 14px; background: #FAFAF8; border: 1px solid #EDE9E2; border-radius: 10px; margin-bottom: 8px; }
        .concept:last-child { margin-bottom: 0; }
        .concept-term { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-bottom: 3px; }
        .concept-def { font-size: 13px; color: #666; line-height: 1.5; }
        .facts-grid { display: flex; flex-direction: column; gap: 8px; }
        .fact { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; background: #F5F5FF; border: 1px solid #E0E7FF; border-radius: 10px; font-size: 13.5px; color: #3730A3; line-height: 1.45; }
        .fact-icon { flex-shrink: 0; font-size: 14px; }
        .quiz-cta { margin: 24px 28px 28px; padding: 16px 20px; background: #1a1a1a; border-radius: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border: none; width: calc(100% - 56px); transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
        .quiz-cta:hover { background: #2d2d2d; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.15); }
        .quiz-cta-text { text-align: left; }
        .quiz-cta-title { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 2px; }
        .quiz-cta-sub { font-size: 12px; color: rgba(255,255,255,0.5); }
        .quiz-cta-arrow { font-size: 20px; color: #fff; opacity: 0.6; }

        /* Loading skeleton */
        .skeleton { background: linear-gradient(90deg, #f0ede8 25%, #e8e4dc 50%, #f0ede8 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 8px; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .skel-title { height: 32px; width: 65%; margin-bottom: 12px; }
        .skel-line { height: 14px; margin-bottom: 8px; border-radius: 6px; }
        .skel-line.short { width: 80%; }
        .skel-line.med { width: 90%; }
        .skel-line.full { width: 100%; }

        /* Quiz */
        .quiz-card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; overflow: hidden; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }
        .quiz-header { padding: 20px 28px; border-bottom: 1px solid #F0EDE8; }
        .progress-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .prog-label { font-size: 12px; font-weight: 600; color: #999; letter-spacing: 0.05em; text-transform: uppercase; }
        .prog-count { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .prog-bar { height: 5px; background: #EDE9E2; border-radius: 99px; overflow: hidden; }
        .prog-fill { height: 100%; background: #5B6AF0; border-radius: 99px; transition: width 0.4s ease; }
        .q-section { padding: 20px 28px; border-bottom: 1px solid #F5F2ED; }
        .q-section:last-child { border-bottom: none; }
        .q-sec-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #C0BAB0; margin-bottom: 16px; }
        .q-block { padding: 16px 0; border-bottom: 1px solid #F7F5F0; }
        .q-block:last-child { border-bottom: none; padding-bottom: 0; }
        .q-block:first-child { padding-top: 0; }
        .q-num { font-family: 'Instrument Serif', serif; font-size: 12px; font-style: italic; color: #5B6AF0; margin-bottom: 4px; }
        .q-text { font-size: 15px; font-weight: 500; color: #1a1a1a; line-height: 1.5; margin-bottom: 11px; }
        .options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
        .opt { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 9px; border: 1.5px solid #EDE9E2; font-size: 13.5px; color: #444; transition: all 0.12s; cursor: pointer; background: #FAFAF8; user-select: none; }
        .opt:hover:not(.locked) { background: #F0EDE8; border-color: #D4CFC7; }
        .opt.locked { cursor: default; }
        .opt.correct { background: #F0FDF4 !important; border-color: #86EFAC !important; color: #166534 !important; }
        .opt.wrong { background: #FFF5F5 !important; border-color: #FCA5A5 !important; color: #9B2C2C !important; }
        .opt-letter { font-size: 11px; font-weight: 700; color: #C0BAB0; flex-shrink: 0; padding-top: 2px; min-width: 14px; }
        .feedback { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 700; }
        .feedback.correct { background: #DCFCE7; color: #166534; }
        .feedback.wrong { background: #FEE2E2; color: #9B2C2C; }
        .reveal-btn { background: none; border: none; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: #5B6AF0; cursor: pointer; padding: 0; }
        .reveal-btn:hover { color: #3D4FD4; }
        .answer-box { margin-top: 10px; padding: 12px 14px; border-radius: 9px; background: #F0FDF4; border: 1px solid #BBF7D0; font-size: 13.5px; color: #166534; line-height: 1.55; }
        .grade-btns { display: flex; gap: 8px; margin-top: 10px; }
        .grade-btn { flex: 1; padding: 9px; border-radius: 9px; border: 1.5px solid; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
        .grade-btn.got { border-color: #86EFAC; background: #F0FDF4; color: #166534; }
        .grade-btn.got:hover { background: #DCFCE7; }
        .grade-btn.miss { border-color: #FCA5A5; background: #FFF5F5; color: #9B2C2C; }
        .grade-btn.miss:hover { background: #FEE2E2; }
        .graded { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; padding: 5px 10px; border-radius: 99px; font-size: 12px; font-weight: 700; }
        .graded.correct { background: #DCFCE7; color: #166534; }
        .graded.wrong { background: #FEE2E2; color: #9B2C2C; }

        /* Score screen */
        .score-screen { padding: 52px 28px; text-align: center; }
        .score-emoji { font-size: 52px; margin-bottom: 10px; }
        .score-num { font-family: 'Instrument Serif', serif; font-size: 80px; line-height: 1; letter-spacing: -3px; color: #1a1a1a; margin-bottom: 4px; }
        .score-num span { color: #5B6AF0; }
        .score-sub { font-size: 16px; color: #999; margin-bottom: 24px; }
        .score-pills { display: flex; gap: 10px; justify-content: center; margin-bottom: 28px; }
        .score-pill { padding: 7px 16px; border-radius: 99px; font-size: 13px; font-weight: 600; }
        .score-pill.mc { background: #F0EFFF; color: #3730A3; }
        .score-pill.sa { background: #F0FDF4; color: #166534; }
        .score-actions { display: flex; gap: 10px; justify-content: center; }
        .act-btn { display: inline-flex; align-items: center; gap: 6px; padding: 12px 24px; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }
        .act-btn.dark { background: #1a1a1a; color: #fff; }
        .act-btn.dark:hover { background: #2d2d2d; transform: translateY(-1px); }
        .act-btn.light { background: #F0EDE8; color: #1a1a1a; }
        .act-btn.light:hover { background: #E4E0D8; transform: translateY(-1px); }
      `}</style>

      <main className="page">
        <div className="container">
          <div className="header">
            <h1 className="logo">Stad<em>e</em></h1>
            <p className="tagline">Turn your notes into exam-ready questions, instantly.</p>
          </div>

          {/* Input */}
          {!hasGenerated && !isLoading && (
            <div className="card">
              <div className={`dropzone${dragOver ? " active" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" accept="application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
                  style={{ display: "none" }} />
                <div className="dz-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5B6AF0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                  </svg>
                </div>
                <p className="dz-title">Drop a PDF here or click to browse</p>
                <p className="dz-sub">Lecture notes, textbooks, study guides</p>
              </div>

              {uploading && <div className="status info"><div className="spinner"></div>Extracting text from PDF…</div>}
              {uploadError && !uploading && <div className="status error"><span className="status-dot"></span>{uploadError}</div>}
              {content && contentSource === "pdf" && !uploading && (
                <div className="status success">
                  <span className="status-dot"></span>
                  📄 {fileName} · {(content.length / 1000).toFixed(1)}k chars loaded
                  <button className="x-btn" onClick={clearAll}>✕</button>
                </div>
              )}

              <div className="divider"><div className="divider-line"></div><span className="divider-text">or paste text</span><div className="divider-line"></div></div>

              <textarea
                placeholder="Paste lecture notes, textbook excerpts, or any study material…"
                value={contentSource === "pdf" ? "" : content}
                onChange={(e) => { if (contentSource === "pdf") return; setContent(e.target.value); setContentSource(e.target.value ? "text" : ""); }}
                disabled={contentSource === "pdf"}
              />

              <button className="btn btn-primary" onClick={generateAll} disabled={isLoading || !content || uploading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Generate Summary &amp; Quiz
              </button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="card">
              <div className="skeleton skel-title"></div>
              <div className="skeleton skel-line med" style={{ marginBottom: 8 }}></div>
              <div className="skeleton skel-line full" style={{ marginBottom: 8 }}></div>
              <div className="skeleton skel-line short" style={{ marginBottom: 24 }}></div>
              <div className="skeleton skel-line med" style={{ marginBottom: 8 }}></div>
              <div className="skeleton skel-line full"></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, color: "#999", fontSize: 13 }}>
                <div className="spinner"></div>
                Generating your summary and quiz questions…
              </div>
            </div>
          )}

          {/* Results */}
          {hasGenerated && !isLoading && (
            <div className="results">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="tabs" style={{ flex: 1, marginBottom: 0, marginRight: 12 }}>
                  <button className={`tab-btn${tab === "summary" ? " active" : ""}`} onClick={() => setTab("summary")}>📋 Summary</button>
                  <button className={`tab-btn${tab === "quiz" ? " active" : ""}`} onClick={() => { setTab("quiz"); }}>🎯 Quiz</button>
                </div>
                <button className="x-btn" style={{ fontSize: 12, fontWeight: 600, opacity: 0.5 }} onClick={clearAll}>✕ New</button>
              </div>

              {/* Summary Tab */}
              {tab === "summary" && (
                <div className="sum-card">
                  {summary ? (
                    <>
                      <div className="sum-hero">
                        <h2 className="sum-title">{summary.title}</h2>
                        <p className="sum-overview">{summary.overview}</p>
                      </div>

                      {summary.key_points?.length > 0 && (
                        <div className="sum-section">
                          <p className="sum-label">Key Points</p>
                          {summary.key_points.map((pt, i) => (
                            <div key={i} className="key-point">
                              <div className="kp-dot"></div>
                              <span>{pt}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {summary.concepts?.length > 0 && (
                        <div className="sum-section">
                          <p className="sum-label">Key Concepts</p>
                          {summary.concepts.map((c, i) => (
                            <div key={i} className="concept">
                              <div className="concept-term">{c.term}</div>
                              <div className="concept-def">{c.definition}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {summary.quick_facts?.length > 0 && (
                        <div className="sum-section">
                          <p className="sum-label">Quick Facts</p>
                          <div className="facts-grid">
                            {summary.quick_facts.map((f, i) => (
                              <div key={i} className="fact">
                                <span className="fact-icon">⚡</span>
                                <span>{f}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button className="quiz-cta" onClick={() => setTab("quiz")}>
                        <div className="quiz-cta-text">
                          <div className="quiz-cta-title">Ready to test yourself?</div>
                          <div className="quiz-cta-sub">{totalQ} questions waiting</div>
                        </div>
                        <span className="quiz-cta-arrow">→</span>
                      </button>
                    </>
                  ) : (
                    <div style={{ padding: 28 }}>
                      <div className="skeleton skel-title"></div>
                      <div className="skeleton skel-line med" style={{ marginBottom: 8 }}></div>
                      <div className="skeleton skel-line full"></div>
                    </div>
                  )}
                </div>
              )}

              {/* Quiz Tab */}
              {tab === "quiz" && (
                <div className="quiz-card">
                  {quizDone ? (
                    <div className="score-screen">
                      <div className="score-emoji">{scoreEmoji}</div>
                      <div className="score-num">{totalScore}<span>/{totalQ}</span></div>
                      <div className="score-sub">
                        {totalScore === totalQ ? "Perfect — flawless!" : totalScore >= totalQ * 0.7 ? "Great work!" : totalScore >= totalQ * 0.4 ? "Keep studying!" : "You'll get there!"}
                      </div>
                      <div className="score-pills">
                        <div className="score-pill mc">MC {mcScore}/{questions?.multiple_choice.length}</div>
                        <div className="score-pill sa">SA {saScore}/{questions?.short_answer.length}</div>
                      </div>
                      <div className="score-actions">
                        <button className="act-btn dark" onClick={resetQuiz}>↺ &nbsp;Retry</button>
                        <button className="act-btn light" onClick={() => setTab("summary")}>← Summary</button>
                        <button className="act-btn light" onClick={clearAll}>New Material</button>
                      </div>
                    </div>
                  ) : questions ? (
                    <>
                      <div className="quiz-header">
                        <div className="progress-row">
                          <span className="prog-label">Progress</span>
                          <span className="prog-count">{totalAnswered} / {totalQ}</span>
                        </div>
                        <div className="prog-bar">
                          <div className="prog-fill" style={{ width: `${totalQ > 0 ? (totalAnswered / totalQ) * 100 : 0}%` }}></div>
                        </div>
                      </div>

                      {questions.multiple_choice.length > 0 && (
                        <div className="q-section">
                          <p className="q-sec-label">Multiple Choice</p>
                          {questions.multiple_choice.map((q, i) => {
                            const s = mcStates[i];
                            if (!s) return null;
                            return (
                              <div key={i} className="q-block">
                                <p className="q-num">Question {i + 1}</p>
                                <p className="q-text">{q.question}</p>
                                <div className="options">
                                  {q.options.map((opt, idx) => {
                                    let cls = "opt";
                                    if (s.locked) { cls += " locked"; if (opt === q.answer) cls += " correct"; else if (opt === s.selected) cls += " wrong"; }
                                    return (
                                      <div key={idx} className={cls} onClick={() => selectMC(i, opt)}>
                                        <span className="opt-letter">{String.fromCharCode(65 + idx)}</span>
                                        <span>{opt}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                {s.locked && (
                                  <div className={`feedback ${s.selected === q.answer ? "correct" : "wrong"}`}>
                                    {s.selected === q.answer ? "✓ Correct!" : `✗ Answer: ${q.answer}`}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {questions.short_answer.length > 0 && (
                        <div className="q-section">
                          <p className="q-sec-label">Short Answer</p>
                          {questions.short_answer.map((q, i) => {
                            const s = saStates[i];
                            if (!s) return null;
                            return (
                              <div key={i} className="q-block">
                                <p className="q-num">Question {i + 1}</p>
                                <p className="q-text">{q.question}</p>
                                {!s.revealed
                                  ? <button className="reveal-btn" onClick={() => revealSA(i)}>Reveal answer</button>
                                  : <>
                                      <div className="answer-box">{q.answer}</div>
                                      {s.graded === null
                                        ? <div className="grade-btns">
                                            <button className="grade-btn got" onClick={() => gradeSA(i, "correct")}>✓ Got it</button>
                                            <button className="grade-btn miss" onClick={() => gradeSA(i, "wrong")}>✗ Missed it</button>
                                          </div>
                                        : <div className={`graded ${s.graded}`}>{s.graded === "correct" ? "✓ Correct" : "✗ Incorrect"}</div>
                                      }
                                    </>
                                }
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ padding: 28 }}>
                      <div className="skeleton skel-line med" style={{ marginBottom: 8 }}></div>
                      <div className="skeleton skel-line full"></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}