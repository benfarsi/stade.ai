"use client";

import { useState, useRef, useEffect } from "react";

type MCQuestion = { question: string; options: string[]; answer: string; difficulty: "easy"|"medium"|"hard" };
type SAQuestion = { question: string; answer: string; difficulty: "easy"|"medium"|"hard" };
type Questions = { multiple_choice: MCQuestion[]; short_answer: SAQuestion[] };
type Summary = { title: string; overview: string; key_points: string[]; concepts: { term: string; definition: string }[]; quick_facts: string[]; exam_tips: string[] };
type MCState = { selected: string | null; locked: boolean };
type SAState = { revealed: boolean; graded: "correct"|"wrong"|null };
type Tab = "summary"|"quiz"|"weakspots";
type Difficulty = "easy"|"medium"|"hard"|"mixed";

type AttemptRecord = { date: string; score: number; max: number };
type WeakQuestion = { question: string; type: "mc"|"sa"; wrongCount: number; lastSeen: string };
type Session = {
  id: string; title: string; date: string;
  summary: Summary; questions: Questions;
  attempts: AttemptRecord[];
  weakQuestions: WeakQuestion[];
};

function getSessions(): Session[] {
  try { return JSON.parse(localStorage.getItem("stade_sessions") || "[]"); } catch { return []; }
}
function saveSessions(sessions: Session[]) {
  try { localStorage.setItem("stade_sessions", JSON.stringify(sessions)); } catch {}
}
function upsertSession(session: Session) {
  const all = getSessions();
  const updated = [session, ...all.filter(s => s.id !== session.id)].slice(0, 20);
  saveSessions(updated);
}

const DIFF_COLORS: Record<string, string> = {
  easy: "#166534", medium: "#92400E", hard: "#9B2C2C",
};
const DIFF_BG: Record<string, string> = {
  easy: "#DCFCE7", medium: "#FEF3C7", hard: "#FEE2E2",
};

export default function Home() {
  const [content, setContent] = useState("");
  const [contentSource, setContentSource] = useState<"pdf"|"text"|"">("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Settings
  const [questionCount, setQuestionCount] = useState(7);
  const [difficulty, setDifficulty] = useState<Difficulty>("mixed");

  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [questions, setQuestions] = useState<Questions | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  const [mcStates, setMcStates] = useState<MCState[]>([]);
  const [saStates, setSaStates] = useState<SAState[]>([]);
  const [quizDone, setQuizDone] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSessions(getSessions()); }, []);

  const mcScore = mcStates.filter((s, i) => s.locked && questions?.multiple_choice[i] && s.selected === questions.multiple_choice[i].answer).length;
  const saScore = saStates.filter(s => s.graded === "correct").length;
  const totalScore = mcScore + saScore;
  const totalQ = (questions?.multiple_choice?.length || 0) + (questions?.short_answer?.length || 0);
  const totalAnswered = mcStates.filter(s => s.locked).length + saStates.filter(s => s.graded !== null).length;

  async function generateAll() {
    if (!content) return;
    setLoadingSummary(true); setLoadingQuiz(true);
    setSummary(null); setQuestions(null); setHasGenerated(false); setQuizDone(false);
    const sessionId = Date.now().toString();

    const [sumRes, qRes] = await Promise.all([
      fetch("/api/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }),
      fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, questionCount, difficulty }) }),
    ]);
    const [sumData, qData] = await Promise.all([sumRes.json(), qRes.json()]);
    const sum: Summary = sumData.summary;
    const q: Questions = qData.result;

    if (sum) setSummary(sum);
    setLoadingSummary(false);
    if (q) {
      setQuestions(q);
      setMcStates(q.multiple_choice.map(() => ({ selected: null, locked: false })));
      setSaStates(q.short_answer.map(() => ({ revealed: false, graded: null })));
    }
    setLoadingQuiz(false);
    setHasGenerated(true);
    setTab("summary");

    if (sum && q) {
      const session: Session = {
        id: sessionId, title: sum.title || fileName || "Untitled",
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        summary: sum, questions: q, attempts: [], weakQuestions: [],
      };
      setCurrentSession(session);
      upsertSession(session);
      setSessions(getSessions());
    }
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
    setCurrentSession(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function loadSession(session: Session) {
    setSummary(session.summary); setQuestions(session.questions);
    setMcStates(session.questions.multiple_choice.map(() => ({ selected: null, locked: false })));
    setSaStates(session.questions.short_answer.map(() => ({ revealed: false, graded: null })));
    setHasGenerated(true); setQuizDone(false); setTab("summary");
    setCurrentSession(session); setShowHistory(false);
  }

  function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = getSessions().filter(s => s.id !== id);
    saveSessions(updated); setSessions(updated);
  }

  function checkAllDone(newMc: MCState[], newSa: SAState[]) {
    if (!newMc.every(s => s.locked) || !newSa.every(s => s.graded !== null)) return;
    setQuizDone(true);

    if (!questions || !currentSession) return;

    const total = newMc.filter((s, i) => s.selected === questions.multiple_choice[i]?.answer).length +
      newSa.filter(s => s.graded === "correct").length;

    // Build weak questions list
    const weakMap = new Map<string, WeakQuestion>(
      currentSession.weakQuestions.map(w => [w.question, w])
    );

    newMc.forEach((s, i) => {
      const q = questions.multiple_choice[i];
      if (!q) return;
      if (s.selected !== q.answer) {
        const existing = weakMap.get(q.question);
        weakMap.set(q.question, { question: q.question, type: "mc", wrongCount: (existing?.wrongCount || 0) + 1, lastSeen: new Date().toISOString() });
      } else {
        weakMap.delete(q.question); // got it right, remove from weak
      }
    });
    newSa.forEach((s, i) => {
      const q = questions.short_answer[i];
      if (!q) return;
      if (s.graded === "wrong") {
        const existing = weakMap.get(q.question);
        weakMap.set(q.question, { question: q.question, type: "sa", wrongCount: (existing?.wrongCount || 0) + 1, lastSeen: new Date().toISOString() });
      } else {
        weakMap.delete(q.question);
      }
    });

    const attempt: AttemptRecord = {
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      score: total, max: totalQ,
    };

    const updated: Session = {
      ...currentSession,
      attempts: [...(currentSession.attempts || []), attempt].slice(-10),
      weakQuestions: Array.from(weakMap.values()).sort((a, b) => b.wrongCount - a.wrongCount),
    };
    setCurrentSession(updated);
    upsertSession(updated);
    setSessions(getSessions());
  }

  function selectMC(qi: number, opt: string) {
    if (mcStates[qi]?.locked) return;
    const newMc = mcStates.map((s, i) => i === qi ? { selected: opt, locked: true } : s);
    setMcStates(newMc); checkAllDone(newMc, saStates);
  }

  function revealSA(qi: number) {
    setSaStates(prev => prev.map((s, i) => i === qi ? { ...s, revealed: true } : s));
  }

  function gradeSA(qi: number, grade: "correct"|"wrong") {
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
  const weakQuestions = currentSession?.weakQuestions || [];
  const attempts = currentSession?.attempts || [];
  const scoreEmoji = totalScore === totalQ ? "🏆" : totalScore >= totalQ * 0.7 ? "🎯" : totalScore >= totalQ * 0.4 ? "📚" : "💪";
  const bestScore = attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : null;
  const prevScore = attempts.length >= 2 ? attempts[attempts.length - 2].score : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #F7F5F0; font-family: 'DM Sans', sans-serif; color: #1a1a1a; }
        .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 56px 24px 96px; }
        .container { width: 100%; max-width: 680px; }
        .header { text-align: center; margin-bottom: 44px; position: relative; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 64px; line-height: 1; letter-spacing: -2px; color: #1a1a1a; }
        .logo em { font-style: italic; color: #5B6AF0; }
        .tagline { font-size: 15px; color: #999; margin-top: 6px; }
        .history-btn { position: absolute; right: 0; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: #fff; border: 1px solid #E8E4DD; border-radius: 10px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; transition: all 0.15s; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
        .history-btn:hover { border-color: #5B6AF0; color: #5B6AF0; }
        .hist-count { background: #5B6AF0; color: #fff; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 99px; }

        .history-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 50; display: flex; justify-content: flex-end; animation: fadeIn 0.15s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .history-panel { width: 360px; height: 100vh; background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.1); display: flex; flex-direction: column; animation: slideIn 0.2s ease; overflow: hidden; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .hist-header { padding: 24px; border-bottom: 1px solid #F0EDE8; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .hist-title { font-family: 'Instrument Serif', serif; font-size: 22px; letter-spacing: -0.5px; }
        .hist-close { background: none; border: none; cursor: pointer; font-size: 20px; color: #999; padding: 0; line-height: 1; }
        .hist-close:hover { color: #1a1a1a; }
        .hist-list { flex: 1; overflow-y: auto; padding: 12px; }
        .hist-empty { text-align: center; padding: 48px 24px; color: #bbb; font-size: 14px; line-height: 1.6; }
        .hist-item { padding: 14px; border-radius: 12px; border: 1px solid #F0EDE8; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; position: relative; }
        .hist-item:hover { border-color: #5B6AF0; background: #F8F8FF; }
        .hist-item-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 28px; }
        .hist-item-meta { font-size: 12px; color: #aaa; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .hist-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; }
        .hist-badge.score { background: #F0EFFF; color: #3730A3; }
        .hist-badge.weak { background: #FEE2E2; color: #9B2C2C; }
        .hist-delete { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: #ccc; padding: 4px; opacity: 0; transition: opacity 0.15s; }
        .hist-item:hover .hist-delete { opacity: 1; }
        .hist-delete:hover { color: #EF4444; }

        .card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; padding: 28px; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }

        /* Settings */
        .settings-row { display: flex; gap: 16px; margin-bottom: 18px; }
        .setting-group { flex: 1; }
        .setting-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #AAA; margin-bottom: 8px; }
        .slider-wrap { display: flex; align-items: center; gap: 10px; }
        .slider { flex: 1; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 99px; background: #EDE9E2; outline: none; cursor: pointer; }
        .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #5B6AF0; cursor: pointer; box-shadow: 0 1px 4px rgba(91,106,240,0.4); }
        .slider-val { font-size: 13px; font-weight: 700; color: #5B6AF0; min-width: 20px; text-align: right; }
        .diff-btns { display: flex; gap: 6px; }
        .diff-btn { flex: 1; padding: 7px 4px; border-radius: 8px; border: 1.5px solid #EDE9E2; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; background: #FAFAF8; color: #888; transition: all 0.12s; text-align: center; }
        .diff-btn.active.easy { background: #DCFCE7; border-color: #86EFAC; color: #166534; }
        .diff-btn.active.medium { background: #FEF3C7; border-color: #FDE68A; color: #92400E; }
        .diff-btn.active.hard { background: #FEE2E2; border-color: #FCA5A5; color: #9B2C2C; }
        .diff-btn.active.mixed { background: #F0EFFF; border-color: #A5B4FC; color: #3730A3; }

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
        .status.warn { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }
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

        .results { margin-top: 20px; }
        .tabs { display: flex; background: #F0EDE8; border-radius: 12px; padding: 3px; }
        .tab-btn { flex: 1; padding: 9px; border: none; border-radius: 9px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; background: none; color: #888; position: relative; }
        .tab-btn.active { background: #fff; color: #1a1a1a; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .tab-badge { position: absolute; top: 4px; right: 6px; background: #EF4444; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 99px; }

        .sum-card, .quiz-card, .weak-card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; overflow: hidden; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }
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
        .fact { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; background: #F5F5FF; border: 1px solid #E0E7FF; border-radius: 10px; font-size: 13.5px; color: #3730A3; line-height: 1.45; margin-bottom: 8px; }
        .fact:last-child { margin-bottom: 0; }
        .quiz-cta { margin: 24px 28px 28px; padding: 16px 20px; background: #1a1a1a; border-radius: 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border: none; width: calc(100% - 56px); transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
        .quiz-cta:hover { background: #2d2d2d; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.15); }
        .quiz-cta-title { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 2px; }
        .quiz-cta-sub { font-size: 12px; color: rgba(255,255,255,0.5); text-align: left; }

        .skeleton { background: linear-gradient(90deg, #f0ede8 25%, #e8e4dc 50%, #f0ede8 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 8px; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

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
        .q-num { font-family: 'Instrument Serif', serif; font-size: 12px; font-style: italic; color: #5B6AF0; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
        .diff-tag { font-style: normal; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px; }
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
        .score-screen { padding: 40px 28px 28px; }
        .score-top { text-align: center; margin-bottom: 28px; }
        .score-emoji { font-size: 48px; margin-bottom: 8px; }
        .score-num { font-family: 'Instrument Serif', serif; font-size: 72px; line-height: 1; letter-spacing: -3px; color: #1a1a1a; margin-bottom: 4px; }
        .score-num span { color: #5B6AF0; }
        .score-sub { font-size: 15px; color: #999; margin-bottom: 16px; }
        .score-pills { display: flex; gap: 8px; justify-content: center; margin-bottom: 16px; flex-wrap: wrap; }
        .score-pill { padding: 6px 14px; border-radius: 99px; font-size: 12px; font-weight: 600; }
        .score-pill.mc { background: #F0EFFF; color: #3730A3; }
        .score-pill.sa { background: #F0FDF4; color: #166534; }
        .score-pill.best { background: #FEF3C7; color: #92400E; }
        .score-pill.improved { background: #DCFCE7; color: #166534; }

        /* Attempt history */
        .attempt-history { background: #FAFAF8; border: 1px solid #EDE9E2; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
        .attempt-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #C0BAB0; margin-bottom: 12px; }
        .attempt-bars { display: flex; align-items: flex-end; gap: 6px; height: 48px; }
        .attempt-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
        .attempt-bar { width: 100%; border-radius: 4px 4px 0 0; transition: height 0.4s ease; min-height: 3px; }
        .attempt-bar.latest { background: #5B6AF0; }
        .attempt-bar.past { background: #D4CFFF; }
        .attempt-label { font-size: 10px; color: #BBB; font-weight: 600; }

        /* Weak spots */
        .weak-section { border-top: 1px solid #F0EDE8; padding: 20px 28px; }
        .weak-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #C0BAB0; margin-bottom: 14px; }
        .weak-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: #FFF5F5; border: 1px solid #FED7D7; border-radius: 10px; margin-bottom: 8px; }
        .weak-item:last-child { margin-bottom: 0; }
        .weak-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
        .weak-q { font-size: 13px; color: #333; line-height: 1.5; flex: 1; }
        .weak-count { font-size: 11px; font-weight: 700; color: #EF4444; flex-shrink: 0; background: #FEE2E2; padding: 2px 7px; border-radius: 99px; margin-top: 1px; }

        /* Weak spots tab */
        .weak-card-content { padding: 24px 28px; }
        .weak-empty { text-align: center; padding: 40px 24px; color: #bbb; font-size: 14px; line-height: 1.6; }

        .score-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
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
            <button className="history-btn" onClick={() => setShowHistory(true)}>
              🕐 History
              {sessions.length > 0 && <span className="hist-count">{sessions.length}</span>}
            </button>
          </div>

          {/* History Panel */}
          {showHistory && (
            <div className="history-overlay" onClick={() => setShowHistory(false)}>
              <div className="history-panel" onClick={e => e.stopPropagation()}>
                <div className="hist-header">
                  <h2 className="hist-title">Past Sessions</h2>
                  <button className="hist-close" onClick={() => setShowHistory(false)}>✕</button>
                </div>
                <div className="hist-list">
                  {sessions.length === 0 ? (
                    <div className="hist-empty">No sessions yet.<br />Generate your first quiz to get started.</div>
                  ) : sessions.map(s => (
                    <div key={s.id} className="hist-item" onClick={() => loadSession(s)}>
                      <div className="hist-item-title">{s.title}</div>
                      <div className="hist-item-meta">
                        <span>{s.date}</span>
                        {s.attempts?.length > 0 && (
                          <span className="hist-badge score">
                            Best: {Math.max(...s.attempts.map(a => a.score))}/{s.attempts[0]?.max}
                          </span>
                        )}
                        {s.weakQuestions?.length > 0 && (
                          <span className="hist-badge weak">⚠ {s.weakQuestions.length} weak</span>
                        )}
                      </div>
                      <button className="hist-delete" onClick={(e) => deleteSession(s.id, e)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Input */}
          {!hasGenerated && !isLoading && (
            <div className="card">
              {/* Settings */}
              <div className="settings-row">
                <div className="setting-group">
                  <div className="setting-label">Questions</div>
                  <div className="slider-wrap">
                    <input type="range" className="slider" min={3} max={15} value={questionCount}
                      onChange={e => setQuestionCount(Number(e.target.value))} />
                    <span className="slider-val">{questionCount}</span>
                  </div>
                </div>
                <div className="setting-group">
                  <div className="setting-label">Difficulty</div>
                  <div className="diff-btns">
                    {(["easy","medium","hard","mixed"] as Difficulty[]).map(d => (
                      <button key={d} className={`diff-btn${difficulty === d ? ` active ${d}` : ""}`}
                        onClick={() => setDifficulty(d)}>
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

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
              {uploadError && !uploading && (
                <div className={`status ${uploadError.includes("scanned") ? "warn" : "error"}`} style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="status-dot"></span>
                    <span style={{ fontWeight: 700 }}>{uploadError.includes("scanned") ? "⚠️ Scanned PDF detected" : "Upload failed"}</span>
                  </div>
                  <div style={{ paddingLeft: 15, fontSize: 12.5, lineHeight: 1.7, opacity: 0.85 }}>
                    {uploadError.split("\n").filter((l: string) => l.trim()).map((line: string, i: number) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
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
                Generate {questionCount} {difficulty !== "mixed" ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1) + " " : ""}Questions
              </button>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="card">
              <div className="skeleton" style={{ height: 32, width: "65%", marginBottom: 12 }}></div>
              <div className="skeleton" style={{ height: 14, width: "90%", marginBottom: 8 }}></div>
              <div className="skeleton" style={{ height: 14, width: "100%", marginBottom: 8 }}></div>
              <div className="skeleton" style={{ height: 14, width: "75%", marginBottom: 24 }}></div>
              <div className="skeleton" style={{ height: 14, width: "85%", marginBottom: 8 }}></div>
              <div className="skeleton" style={{ height: 14, width: "100%" }}></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, color: "#999", fontSize: 13 }}>
                <div className="spinner"></div>
                Generating your summary and {questionCount} quiz questions…
              </div>
            </div>
          )}

          {/* Results */}
          {hasGenerated && !isLoading && (
            <div className="results">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="tabs" style={{ flex: 1, marginRight: 12 }}>
                  <button className={`tab-btn${tab === "summary" ? " active" : ""}`} onClick={() => setTab("summary")}>📋 Summary</button>
                  <button className={`tab-btn${tab === "quiz" ? " active" : ""}`} onClick={() => setTab("quiz")}>🎯 Quiz</button>
                  <button className={`tab-btn${tab === "weakspots" ? " active" : ""}`} onClick={() => setTab("weakspots")}>
                    ⚠️ Weak Spots
                    {weakQuestions.length > 0 && <span className="tab-badge">{weakQuestions.length}</span>}
                  </button>
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
                            <div key={i} className="key-point"><div className="kp-dot"></div><span>{pt}</span></div>
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
                          {summary.quick_facts.map((f, i) => (
                            <div key={i} className="fact"><span>⚡</span><span>{f}</span></div>
                          ))}
                        </div>
                      )}
                      {summary.exam_tips?.length > 0 && (
                        <div className="sum-section">
                          <p className="sum-label">Exam Tips</p>
                          {summary.exam_tips.map((t, i) => (
                            <div key={i} className="fact" style={{ background: "#FFFBEB", borderColor: "#FDE68A", color: "#92400E" }}>
                              <span>🎯</span><span>{t}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <button className="quiz-cta" onClick={() => setTab("quiz")}>
                        <div>
                          <div className="quiz-cta-title">Ready to test yourself?</div>
                          <div className="quiz-cta-sub">{totalQ} questions · {difficulty} difficulty</div>
                        </div>
                        <span style={{ fontSize: 20, color: "#fff", opacity: 0.6 }}>→</span>
                      </button>
                    </>
                  ) : (
                    <div style={{ padding: 28 }}>
                      <div className="skeleton" style={{ height: 32, width: "65%", marginBottom: 12 }}></div>
                      <div className="skeleton" style={{ height: 14, width: "90%", marginBottom: 8 }}></div>
                      <div className="skeleton" style={{ height: 14, width: "100%" }}></div>
                    </div>
                  )}
                </div>
              )}

              {/* Quiz Tab */}
              {tab === "quiz" && (
                <div className="quiz-card">
                  {quizDone ? (
                    <div className="score-screen">
                      <div className="score-top">
                        <div className="score-emoji">{scoreEmoji}</div>
                        <div className="score-num">{totalScore}<span>/{totalQ}</span></div>
                        <div className="score-sub">
                          {totalScore === totalQ ? "Perfect — flawless!" : totalScore >= totalQ * 0.7 ? "Great work!" : totalScore >= totalQ * 0.4 ? "Keep studying!" : "You'll get there!"}
                        </div>
                        <div className="score-pills">
                          <div className="score-pill mc">MC {mcScore}/{questions?.multiple_choice.length}</div>
                          <div className="score-pill sa">SA {saScore}/{questions?.short_answer.length}</div>
                          {bestScore !== null && attempts.length > 1 && <div className="score-pill best">🏅 Best: {bestScore}/{totalQ}</div>}
                          {prevScore !== null && totalScore > prevScore && <div className="score-pill improved">↑ +{totalScore - prevScore} from last</div>}
                        </div>
                      </div>

                      {/* Attempt History Chart */}
                      {attempts.length > 1 && (
                        <div className="attempt-history">
                          <div className="attempt-title">Attempt History</div>
                          <div className="attempt-bars">
                            {attempts.slice(-8).map((a, i, arr) => (
                              <div key={i} className="attempt-bar-wrap">
                                <div className={`attempt-bar ${i === arr.length - 1 ? "latest" : "past"}`}
                                  style={{ height: `${Math.max(10, (a.score / a.max) * 100)}%` }}></div>
                                <div className="attempt-label">{a.date}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Weak spots preview */}
                      {weakQuestions.length > 0 && (
                        <div className="weak-section">
                          <div className="weak-title">⚠️ Needs Review ({weakQuestions.length})</div>
                          {weakQuestions.slice(0, 3).map((w, i) => (
                            <div key={i} className="weak-item">
                              <span className="weak-icon">🔁</span>
                              <span className="weak-q">{w.question}</span>
                              <span className="weak-count">✗ {w.wrongCount}×</span>
                            </div>
                          ))}
                          {weakQuestions.length > 3 && (
                            <button className="reveal-btn" style={{ marginTop: 8 }} onClick={() => setTab("weakspots")}>
                              +{weakQuestions.length - 3} more → View all
                            </button>
                          )}
                        </div>
                      )}

                      <div className="score-actions" style={{ marginTop: 24 }}>
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
                            const s = mcStates[i]; if (!s) return null;
                            return (
                              <div key={i} className="q-block">
                                <p className="q-num">
                                  Question {i + 1}
                                  {q.difficulty && (
                                    <span className="diff-tag" style={{ background: DIFF_BG[q.difficulty], color: DIFF_COLORS[q.difficulty] }}>
                                      {q.difficulty}
                                    </span>
                                  )}
                                </p>
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
                            const s = saStates[i]; if (!s) return null;
                            return (
                              <div key={i} className="q-block">
                                <p className="q-num">
                                  Question {i + 1}
                                  {q.difficulty && (
                                    <span className="diff-tag" style={{ background: DIFF_BG[q.difficulty], color: DIFF_COLORS[q.difficulty] }}>
                                      {q.difficulty}
                                    </span>
                                  )}
                                </p>
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
                      <div className="skeleton" style={{ height: 14, width: "90%", marginBottom: 8 }}></div>
                      <div className="skeleton" style={{ height: 14, width: "100%" }}></div>
                    </div>
                  )}
                </div>
              )}

              {/* Weak Spots Tab */}
              {tab === "weakspots" && (
                <div className="weak-card">
                  <div className="weak-card-content">
                    <div className="sum-label" style={{ marginBottom: 16 }}>Questions to Review</div>
                    {weakQuestions.length === 0 ? (
                      <div className="weak-empty">
                        🎉 No weak spots yet!<br />Complete a quiz to start tracking which questions need more practice.
                      </div>
                    ) : (
                      <>
                        <p style={{ fontSize: 13, color: "#999", marginBottom: 16, lineHeight: 1.5 }}>
                          These questions have tripped you up before. Focus on these next time you study.
                        </p>
                        {weakQuestions.map((w, i) => (
                          <div key={i} className="weak-item">
                            <span className="weak-icon">🔁</span>
                            <div style={{ flex: 1 }}>
                              <div className="weak-q">{w.question}</div>
                              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                                {w.type === "mc" ? "Multiple choice" : "Short answer"}
                              </div>
                            </div>
                            <span className="weak-count">✗ {w.wrongCount}×</span>
                          </div>
                        ))}
                        <div style={{ marginTop: 16, padding: "12px 14px", background: "#F5F5FF", border: "1px solid #E0E7FF", borderRadius: 10, fontSize: 13, color: "#3730A3", lineHeight: 1.5 }}>
                          💡 <strong>Tip:</strong> Retry the quiz focusing on these questions. They'll be removed from weak spots once you answer them correctly.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}