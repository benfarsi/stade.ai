"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type MCQuestion = { question: string; options: string[]; answer: string; difficulty: "easy"|"medium"|"hard" };
type SAQuestion = { question: string; answer: string; difficulty: "easy"|"medium"|"hard" };
type Questions = { multiple_choice: MCQuestion[]; short_answer: SAQuestion[] };
type Summary = { title: string; overview: string; key_points: string[]; concepts: { term: string; definition: string }[]; quick_facts: string[]; exam_tips: string[] };
type MCState = { selected: string | null; locked: boolean };
type SAState = { userAnswer: string; grading: boolean; result: { score: number; isCorrect: boolean; feedback: string } | null };
type Tab = "summary"|"flashcards"|"quiz"|"weakspots";
type Difficulty = "easy"|"medium"|"hard"|"mixed";

type AttemptRecord = { date: string; score: number; max: number };
type WeakQuestion = { question: string; type: "mc"|"sa"; wrongCount: number; lastSeen: string };
type Session = {
  id: string; title: string; date: string;
  summary: Summary; questions: Questions;
  attempts: AttemptRecord[];
  weakQuestions: WeakQuestion[];
  shareToken?: string;
};

interface CardSRS {
  interval: number;
  easeFactor: number;
  repetitions: number;
  dueDate: number;
}

function termKey(term: string): string {
  return term.toLowerCase().replace(/\s+/g, "_").slice(0, 50);
}

function getSRSStore(): Record<string, CardSRS> {
  try { return JSON.parse(localStorage.getItem("stade_srs") || "{}"); } catch { return {}; }
}

function saveSRSStore(store: Record<string, CardSRS>) {
  try { localStorage.setItem("stade_srs", JSON.stringify(store)); } catch {}
}

function sm2Update(srs: CardSRS, quality: 1|2|3|4): CardSRS {
  const q = ([0, 0, 2, 4, 5] as const)[quality];
  let { interval, easeFactor, repetitions } = srs;
  if (q >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions++;
  } else {
    repetitions = 0;
    interval = 1;
  }
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  return { interval, easeFactor, repetitions, dueDate: Date.now() + interval * 86400000 };
}

function defaultCardSRS(): CardSRS {
  return { interval: 0, easeFactor: 2.5, repetitions: 0, dueDate: 0 };
}

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

const DIFF_COLORS: Record<string, string> = { easy: "#166534", medium: "#92400E", hard: "#9B2C2C" };
const DIFF_BG: Record<string, string> = { easy: "#DCFCE7", medium: "#FEF3C7", hard: "#FEE2E2" };

export default function Home() {
  const [content, setContent] = useState("");
  const [contentSource, setContentSource] = useState<"pdf"|"text"|"">("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [questionCount, setQuestionCount] = useState(7);
  const [difficulty, setDifficulty] = useState<Difficulty>("mixed");

  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [questions, setQuestions] = useState<Questions | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  // Streaming
  const [streamProgress, setStreamProgress] = useState(0);
  const [streamingTitle, setStreamingTitle] = useState("");

  const [mcStates, setMcStates] = useState<MCState[]>([]);
  const [saStates, setSaStates] = useState<SAState[]>([]);
  const [quizDone, setQuizDone] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Flashcards + SRS
  const [cardIndex, setCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [srsStore, setSrsStore] = useState<Record<string, CardSRS>>({});
  const [reviewMode, setReviewMode] = useState(false);

  // UI
  const [darkMode, setDarkMode] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSessions(getSessions()); setSrsStore(getSRSStore()); }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("stade_dark");
      if (saved === "1") setDarkMode(true);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    try { localStorage.setItem("stade_dark", darkMode ? "1" : "0"); } catch {}
  }, [darkMode]);

  const concepts = summary?.concepts || [];
  const reviewConcepts = reviewMode
    ? concepts.filter(c => (srsStore[termKey(c.term)]?.dueDate ?? 0) <= Date.now())
    : concepts;
  const activeCardIndex = Math.min(cardIndex, reviewConcepts.length - 1);
  const dueCount = concepts.filter(c => (srsStore[termKey(c.term)]?.dueDate ?? 0) <= Date.now()).length;

  const mcScore = mcStates.filter((s, i) => s.locked && questions?.multiple_choice[i] && s.selected === questions.multiple_choice[i].answer).length;
  const saScore = saStates.filter(s => s.result?.isCorrect).length;
  const totalScore = mcScore + saScore;
  const totalQ = (questions?.multiple_choice?.length || 0) + (questions?.short_answer?.length || 0);
  const totalAnswered = mcStates.filter(s => s.locked).length + saStates.filter(s => s.result !== null).length;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function copyShare() {
    const token = currentSession?.shareToken;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function rateCard(quality: 1|2|3|4) {
    const cards = reviewMode ? reviewConcepts : concepts;
    const card = cards[activeCardIndex];
    if (!card) return;
    const key = termKey(card.term);
    const existing = srsStore[key] ?? defaultCardSRS();
    const updated = sm2Update(existing, quality);
    const newStore = { ...srsStore, [key]: updated };
    setSrsStore(newStore);
    saveSRSStore(newStore);
    setCardFlipped(false);
    if (activeCardIndex < cards.length - 1) {
      setCardIndex(activeCardIndex + 1);
    } else {
      setCardIndex(0);
    }
  }

  function nextCard() {
    const cards = reviewMode ? reviewConcepts : concepts;
    if (!cards.length) return;
    setCardIndex(i => (i + 1) % cards.length);
    setCardFlipped(false);
  }

  function prevCard() {
    const cards = reviewMode ? reviewConcepts : concepts;
    if (!cards.length) return;
    setCardIndex(i => (i - 1 + cards.length) % cards.length);
    setCardFlipped(false);
  }

  async function gradeAnswer(qi: number) {
    const q = questions?.short_answer[qi];
    const s = saStates[qi];
    if (!q || !s || !s.userAnswer.trim() || s.grading || s.result) return;

    const newSa = saStates.map((st, i) => i === qi ? { ...st, grading: true } : st);
    setSaStates(newSa);

    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.question, correctAnswer: q.answer, userAnswer: s.userAnswer }),
      });
      const result = await res.json();
      const finalSa = saStates.map((st, i) => i === qi ? { ...st, grading: false, result } : st);
      setSaStates(finalSa);
      checkAllDone(mcStates, finalSa);
    } catch {
      const finalSa = saStates.map((st, i) => i === qi ? { ...st, grading: false, result: { score: 0, isCorrect: false, feedback: "Grading failed." } } : st);
      setSaStates(finalSa);
    }
  }

  async function generateAll() {
    if (!content) return;
    setLoadingSummary(true); setLoadingQuiz(true);
    setSummary(null); setQuestions(null); setHasGenerated(false); setQuizDone(false);
    setCardIndex(0); setCardFlipped(false); setStreamProgress(0); setStreamingTitle("");
    const sessionId = Date.now().toString();

    // Start quiz fetch in parallel (regular)
    const quizPromise = fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, questionCount, difficulty }),
    });

    // Stream summary
    let sum: Summary | null = null;
    let savedId: string | null = null;
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.body) throw new Error("No stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setStreamProgress(Math.min(92, (accumulated.length / 3500) * 100));
        const m = accumulated.match(/"title"\s*:\s*"([^"\\]{3,})"/);
        if (m?.[1]) setStreamingTitle(m[1]);
      }

      const doneIdx = accumulated.indexOf("\n\n__DONE__");
      if (doneIdx !== -1) {
        const meta = JSON.parse(accumulated.slice(doneIdx + "\n\n__DONE__".length));
        sum = meta.summary;
        savedId = meta.savedId ?? null;
      }
    } catch (e) {
      console.error("Summary stream error", e);
    }

    setStreamProgress(100);
    if (sum) setSummary(sum);
    setLoadingSummary(false);

    // Wait for quiz
    try {
      const qRes = await quizPromise;
      const qData = await qRes.json();
      const q: Questions = qData.result;
      if (q) {
        setQuestions(q);
        setMcStates(q.multiple_choice.map(() => ({ selected: null, locked: false })));
        setSaStates(q.short_answer.map(() => ({ userAnswer: "", grading: false, result: null })));
      }
    } catch (e) {
      console.error("Quiz error", e);
    }
    setLoadingQuiz(false);
    setHasGenerated(true);
    setTab("summary");

    if (sum) {
      const session: Session = {
        id: sessionId,
        title: sum.title || fileName || "Untitled",
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        summary: sum,
        questions: questions || { multiple_choice: [], short_answer: [] },
        attempts: [],
        weakQuestions: [],
        shareToken: savedId ?? undefined,
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
    setCurrentSession(null); setCardIndex(0); setCardFlipped(false);
    setStreamProgress(0); setStreamingTitle(""); setReviewMode(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function loadSession(session: Session) {
    setSummary(session.summary); setQuestions(session.questions);
    setMcStates(session.questions.multiple_choice.map(() => ({ selected: null, locked: false })));
    setSaStates(session.questions.short_answer.map(() => ({ userAnswer: "", grading: false, result: null })));
    setHasGenerated(true); setQuizDone(false); setTab("summary");
    setCurrentSession(session); setShowHistory(false);
    setCardIndex(0); setCardFlipped(false); setReviewMode(false);
  }

  function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = getSessions().filter(s => s.id !== id);
    saveSessions(updated); setSessions(updated);
  }

  function checkAllDone(newMc: MCState[], newSa: SAState[]) {
    if (!newMc.every(s => s.locked) || !newSa.every(s => s.result !== null)) return;
    setQuizDone(true);
    if (!questions || !currentSession) return;

    const total = newMc.filter((s, i) => s.selected === questions.multiple_choice[i]?.answer).length +
      newSa.filter(s => s.result?.isCorrect).length;

    const weakMap = new Map<string, WeakQuestion>(currentSession.weakQuestions.map(w => [w.question, w]));
    newMc.forEach((s, i) => {
      const q = questions.multiple_choice[i]; if (!q) return;
      if (s.selected !== q.answer) {
        const ex = weakMap.get(q.question);
        weakMap.set(q.question, { question: q.question, type: "mc", wrongCount: (ex?.wrongCount || 0) + 1, lastSeen: new Date().toISOString() });
      } else { weakMap.delete(q.question); }
    });
    newSa.forEach((s, i) => {
      const q = questions.short_answer[i]; if (!q) return;
      if (!s.result?.isCorrect) {
        const ex = weakMap.get(q.question);
        weakMap.set(q.question, { question: q.question, type: "sa", wrongCount: (ex?.wrongCount || 0) + 1, lastSeen: new Date().toISOString() });
      } else { weakMap.delete(q.question); }
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

  function resetQuiz() {
    if (!questions) return;
    setMcStates(questions.multiple_choice.map(() => ({ selected: null, locked: false })));
    setSaStates(questions.short_answer.map(() => ({ userAnswer: "", grading: false, result: null })));
    setQuizDone(false);
  }

  const isLoading = loadingSummary || loadingQuiz;
  const weakQuestions = currentSession?.weakQuestions || [];
  const attempts = currentSession?.attempts || [];
  const scoreEmoji = totalScore === totalQ ? "🏆" : totalScore >= totalQ * 0.7 ? "🎯" : totalScore >= totalQ * 0.4 ? "📚" : "💪";
  const bestScore = attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : null;
  const prevScore = attempts.length >= 2 ? attempts[attempts.length - 2].score : null;

  const displayCards = reviewMode ? reviewConcepts : concepts;
  const currentCard = displayCards[activeCardIndex];
  const currentCardSRS = currentCard ? (srsStore[termKey(currentCard.term)] ?? defaultCardSRS()) : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #F7F5F0; font-family: 'DM Sans', sans-serif; color: #1a1a1a; transition: background 0.2s, color 0.2s; }
        .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 56px 24px 96px; }
        .container { width: 100%; max-width: 680px; }

        .header { text-align: center; margin-bottom: 44px; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 64px; line-height: 1; letter-spacing: -2px; color: #1a1a1a; }
        .logo em { font-style: italic; color: #5B6AF0; }
        .tagline { font-size: 15px; color: #999; margin-top: 6px; margin-bottom: 14px; }
        .header-btns { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
        .header-icon-btn { display: flex; align-items: center; justify-content: center; padding: 8px 12px; background: #fff; border: 1px solid #E8E4DD; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; box-shadow: 0 1px 4px rgba(0,0,0,0.06); font-family: 'DM Sans', sans-serif; color: #555; }
        .header-icon-btn:hover { border-color: #5B6AF0; color: #5B6AF0; }
        .history-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: #fff; border: 1px solid #E8E4DD; border-radius: 10px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; transition: all 0.15s; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
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

        /* Stream progress */
        .stream-card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; padding: 28px; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }
        .stream-title { font-family: 'Instrument Serif', serif; font-size: 22px; letter-spacing: -0.3px; color: #1a1a1a; margin-bottom: 16px; min-height: 28px; }
        .stream-bar-wrap { height: 4px; background: #EDE9E2; border-radius: 99px; overflow: hidden; margin-bottom: 14px; }
        .stream-bar { height: 100%; background: linear-gradient(90deg, #5B6AF0, #818CF8); border-radius: 99px; transition: width 0.3s ease; }
        .stream-steps { display: flex; flex-direction: column; gap: 8px; }
        .stream-step { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #999; }
        .stream-step.active { color: #5B6AF0; }
        .stream-step.done { color: #22C55E; }
        .step-dot { width: 7px; height: 7px; border-radius: 50%; background: #EDE9E2; flex-shrink: 0; }
        .stream-step.active .step-dot { background: #5B6AF0; animation: pulse 1s infinite; }
        .stream-step.done .step-dot { background: #22C55E; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

        .results { margin-top: 20px; }
        .tabs { display: flex; background: #F0EDE8; border-radius: 12px; padding: 3px; }
        .tab-btn { flex: 1; padding: 9px 4px; border: none; border-radius: 9px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; background: none; color: #888; position: relative; }
        .tab-btn.active { background: #fff; color: #1a1a1a; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .tab-badge { position: absolute; top: 3px; right: 3px; background: #EF4444; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 99px; line-height: 1.4; }
        .tab-badge.blue { background: #5B6AF0; }

        .sum-card, .quiz-card, .weak-card, .fc-card { background: #fff; border-radius: 20px; border: 1px solid #E8E4DD; overflow: hidden; box-shadow: 0 1px 12px rgba(0,0,0,0.04); }
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

        /* SA with AI grading */
        .sa-input-wrap { display: flex; flex-direction: column; gap: 8px; }
        .sa-input { width: 100%; padding: 10px 12px; border: 1.5px solid #EDE9E2; border-radius: 9px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; color: #1a1a1a; background: #FAFAF8; resize: none; outline: none; height: 80px; transition: border-color 0.2s; line-height: 1.5; }
        .sa-input:focus { border-color: #5B6AF0; background: #fff; }
        .sa-input:disabled { opacity: 0.5; }
        .sa-submit { align-self: flex-start; padding: 8px 18px; background: #5B6AF0; color: #fff; border: none; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
        .sa-submit:hover:not(:disabled) { background: #4A5AE0; transform: translateY(-1px); }
        .sa-submit:disabled { opacity: 0.45; cursor: not-allowed; }
        .ai-grade-result { margin-top: 10px; padding: 12px 14px; border-radius: 10px; }
        .ai-grade-result.correct { background: #F0FDF4; border: 1px solid #BBF7D0; }
        .ai-grade-result.wrong { background: #FFF5F5; border: 1px solid #FED7D7; }
        .ai-grade-result.partial { background: #FFFBEB; border: 1px solid #FDE68A; }
        .ai-grade-score { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .ai-score-badge { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 99px; }
        .ai-score-badge.correct { background: #DCFCE7; color: #166534; }
        .ai-score-badge.wrong { background: #FEE2E2; color: #9B2C2C; }
        .ai-score-badge.partial { background: #FEF3C7; color: #92400E; }
        .ai-feedback { font-size: 13px; line-height: 1.55; color: #555; }

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

        .attempt-history { background: #FAFAF8; border: 1px solid #EDE9E2; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
        .attempt-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #C0BAB0; margin-bottom: 12px; }
        .attempt-bars { display: flex; align-items: flex-end; gap: 6px; height: 48px; }
        .attempt-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
        .attempt-bar { width: 100%; border-radius: 4px 4px 0 0; transition: height 0.4s ease; min-height: 3px; }
        .attempt-bar.latest { background: #5B6AF0; }
        .attempt-bar.past { background: #D4CFFF; }
        .attempt-label { font-size: 10px; color: #BBB; font-weight: 600; }

        .weak-section { border-top: 1px solid #F0EDE8; padding: 20px 28px; }
        .weak-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #C0BAB0; margin-bottom: 14px; }
        .weak-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: #FFF5F5; border: 1px solid #FED7D7; border-radius: 10px; margin-bottom: 8px; }
        .weak-item:last-child { margin-bottom: 0; }
        .weak-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
        .weak-q { font-size: 13px; color: #333; line-height: 1.5; flex: 1; }
        .weak-count { font-size: 11px; font-weight: 700; color: #EF4444; flex-shrink: 0; background: #FEE2E2; padding: 2px 7px; border-radius: 99px; margin-top: 1px; }
        .weak-card-content { padding: 24px 28px; }
        .weak-empty { text-align: center; padding: 40px 24px; color: #bbb; font-size: 14px; line-height: 1.6; }

        .score-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .act-btn { display: inline-flex; align-items: center; gap: 6px; padding: 12px 24px; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }
        .act-btn.dark { background: #1a1a1a; color: #fff; }
        .act-btn.dark:hover { background: #2d2d2d; transform: translateY(-1px); }
        .act-btn.light { background: #F0EDE8; color: #1a1a1a; }
        .act-btn.light:hover { background: #E4E0D8; transform: translateY(-1px); }

        /* Flashcards */
        .fc-wrap { padding: 24px 28px; }
        .fc-top-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 8px; flex-wrap: wrap; }
        .fc-count { font-size: 13px; font-weight: 600; color: #999; }
        .fc-review-btn { padding: 5px 12px; border-radius: 99px; border: 1.5px solid; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .fc-review-btn.on { background: #5B6AF0; border-color: #5B6AF0; color: #fff; }
        .fc-review-btn.off { background: #F0EFFF; border-color: #C7D2FE; color: #3730A3; }
        .fc-dots { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 18px; }
        .fc-dot { width: 8px; height: 8px; border-radius: 50%; cursor: pointer; transition: background 0.2s; flex-shrink: 0; }
        .fc-container { perspective: 1200px; cursor: pointer; width: 100%; margin-bottom: 14px; user-select: none; }
        .fc-inner { position: relative; width: 100%; height: 210px; transform-style: preserve-3d; transition: transform 0.45s cubic-bezier(0.4,0,0.2,1); }
        .fc-inner.flipped { transform: rotateY(180deg); }
        .fc-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; border-radius: 16px; text-align: center; }
        .fc-front { background: #fff; border: 1px solid #E8E4DD; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
        .fc-back { background: #F0EFFF; border: 1px solid #C7D2FE; box-shadow: 0 2px 12px rgba(91,106,240,0.1); transform: rotateY(180deg); }
        .fc-label { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 12px; }
        .fc-term { font-family: 'Instrument Serif', serif; font-size: 22px; color: #1a1a1a; line-height: 1.3; letter-spacing: -0.3px; }
        .fc-def { font-size: 13.5px; color: #3730A3; line-height: 1.6; }
        .fc-hint { font-size: 11px; color: #C0BAB0; margin-top: 12px; }
        .fc-srs-info { font-size: 11px; color: #aaa; text-align: center; margin-bottom: 12px; }
        .srs-btns { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin-bottom: 12px; }
        .srs-btn { padding: 9px 4px; border-radius: 10px; border: 1.5px solid; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.12s; text-align: center; line-height: 1.3; }
        .srs-btn.again { border-color: #FCA5A5; background: #FFF5F5; color: #9B2C2C; }
        .srs-btn.again:hover { background: #FEE2E2; }
        .srs-btn.hard { border-color: #FDE68A; background: #FFFBEB; color: #92400E; }
        .srs-btn.hard:hover { background: #FEF3C7; }
        .srs-btn.good { border-color: #A5B4FC; background: #F0EFFF; color: #3730A3; }
        .srs-btn.good:hover { background: #E0E7FF; }
        .srs-btn.easy { border-color: #86EFAC; background: #F0FDF4; color: #166534; }
        .srs-btn.easy:hover { background: #DCFCE7; }
        .srs-btn-sub { font-size: 10px; font-weight: 500; opacity: 0.7; }
        .fc-nav { display: flex; gap: 10px; margin-top: 4px; }
        .fc-nav-btn { flex: 1; padding: 10px; border-radius: 11px; border: 1.5px solid #EDE9E2; background: #FAFAF8; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; transition: all 0.12s; }
        .fc-nav-btn:hover { border-color: #5B6AF0; color: #5B6AF0; background: #F5F5FF; }
        .fc-empty { padding: 48px 28px; text-align: center; color: #bbb; font-size: 14px; line-height: 1.6; }

        /* Dark mode */
        html.dark body { background: #0f0f15; color: #e8e8f0; }
        html.dark .logo { color: #e8e8f0; }
        html.dark .card, html.dark .stream-card { background: #1a1a26; border-color: #2d2d40; }
        html.dark .header-icon-btn, html.dark .history-btn { background: #1a1a26; border-color: #2d2d40; color: #aaa; }
        html.dark .header-icon-btn:hover, html.dark .history-btn:hover { border-color: #5B6AF0; color: #5B6AF0; }
        html.dark .history-panel { background: #1a1a26; }
        html.dark .hist-header { border-bottom-color: #2d2d40; }
        html.dark .hist-title, html.dark .hist-item-title { color: #e8e8f0; }
        html.dark .hist-close { color: #666; }
        html.dark .hist-item { border-color: #2d2d40; }
        html.dark .hist-item:hover { background: #22223a; border-color: #5B6AF0; }
        html.dark .sum-card, html.dark .quiz-card, html.dark .weak-card, html.dark .fc-card { background: #1a1a26; border-color: #2d2d40; }
        html.dark .sum-hero, html.dark .sum-section { border-bottom-color: #2d2d40; }
        html.dark .sum-title { color: #e8e8f0; }
        html.dark .sum-overview, html.dark .key-point { color: #aaa; }
        html.dark .concept { background: #1f1f30; border-color: #2d2d40; }
        html.dark .concept-term { color: #e8e8f0; }
        html.dark .concept-def { color: #999; }
        html.dark .dropzone { background: #1f1f30; border-color: #3d3d55; }
        html.dark .dropzone:hover { background: #22223a; border-color: #5B6AF0; }
        html.dark .dz-title { color: #e8e8f0; }
        html.dark textarea, html.dark .sa-input { background: #1f1f30; border-color: #2d2d40; color: #e8e8f0; }
        html.dark textarea:focus, html.dark .sa-input:focus { border-color: #5B6AF0; background: #22223a; }
        html.dark .tabs { background: #1f1f30; }
        html.dark .tab-btn { color: #777; }
        html.dark .tab-btn.active { background: #2d2d40; color: #e8e8f0; }
        html.dark .q-text { color: #e8e8f0; }
        html.dark .opt { background: #1f1f30; border-color: #2d2d40; color: #bbb; }
        html.dark .opt:hover:not(.locked) { background: #252538; border-color: #3d3d55; }
        html.dark .attempt-history { background: #1f1f30; border-color: #2d2d40; }
        html.dark .weak-section { border-top-color: #2d2d40; }
        html.dark .weak-item { background: #2e1a1a; border-color: #4d2d2d; }
        html.dark .weak-q { color: #ccc; }
        html.dark .quiz-header { border-bottom-color: #2d2d40; }
        html.dark .q-section { border-bottom-color: #2d2d40; }
        html.dark .q-block { border-bottom-color: #252538; }
        html.dark .prog-bar { background: #2d2d40; }
        html.dark .score-num { color: #e8e8f0; }
        html.dark .fc-front { background: #1a1a26; border-color: #2d2d40; }
        html.dark .fc-term { color: #e8e8f0; }
        html.dark .fc-nav-btn { background: #1f1f30; border-color: #2d2d40; color: #aaa; }
        html.dark .fc-nav-btn:hover { border-color: #5B6AF0; color: #5B6AF0; background: #22223a; }
        html.dark .act-btn.light { background: #1f1f30; color: #ccc; }
        html.dark .act-btn.light:hover { background: #2d2d40; }
        html.dark .diff-btn { background: #1f1f30; border-color: #2d2d40; color: #666; }
        html.dark .slider { background: #2d2d40; }
        html.dark .divider-line { background: #2d2d40; }
        html.dark .quiz-cta { background: #22223a; }
        html.dark .stream-bar-wrap { background: #2d2d40; }
        html.dark .ai-feedback { color: #bbb; }
        html.dark .fc-review-btn.off { background: #1f1f30; border-color: #3d3d55; }
        html.dark .srs-btn.again { background: #2e1a1a; } html.dark .srs-btn.hard { background: #2a2414; }
        html.dark .srs-btn.good { background: #1a1a2e; } html.dark .srs-btn.easy { background: #1a2e1a; }

        /* Mobile */
        @media (max-width: 520px) {
          .page { padding: 28px 14px 80px; }
          .logo { font-size: 48px; letter-spacing: -1.5px; }
          .header { margin-bottom: 28px; }
          .tagline { font-size: 13px; }
          .settings-row { flex-direction: column; gap: 12px; }
          .sum-hero { padding: 20px; }
          .sum-section { padding: 16px 20px; }
          .sum-title { font-size: 22px; }
          .quiz-header { padding: 16px 20px; }
          .q-section { padding: 16px 20px; }
          .score-num { font-size: 54px; letter-spacing: -2px; }
          .score-screen { padding: 28px 20px 20px; }
          .weak-card-content { padding: 20px; }
          .weak-section { padding: 16px 20px; }
          .quiz-cta { margin: 16px 20px 20px; width: calc(100% - 40px); }
          .fc-wrap { padding: 20px; }
          .fc-inner { height: 180px; }
          .fc-term { font-size: 18px; }
          .history-panel { width: 100%; }
          .act-btn { padding: 11px 16px; font-size: 13px; }
          .tab-btn { font-size: 11px; }
          .srs-btns { gap: 4px; }
          .srs-btn { font-size: 11px; padding: 8px 2px; }
        }
      `}</style>

      <main className="page">
        <div className="container">
          <div className="header">
            <h1 className="logo">Stad<em>e</em></h1>
            <p className="tagline">Turn your notes into exam-ready questions, instantly.</p>
            <div className="header-btns">
              <button className="header-icon-btn" onClick={() => setDarkMode(d => !d)} title="Toggle dark mode">
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button className="history-btn" onClick={() => setShowHistory(true)}>
                🕐 History
                {sessions.length > 0 && <span className="hist-count">{sessions.length}</span>}
              </button>
              <button className="header-icon-btn" onClick={signOut}>Sign out</button>
            </div>
          </div>

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
                        {s.attempts?.length > 0 && <span className="hist-badge score">Best: {Math.max(...s.attempts.map(a => a.score))}/{s.attempts[0]?.max}</span>}
                        {s.weakQuestions?.length > 0 && <span className="hist-badge weak">⚠ {s.weakQuestions.length} weak</span>}
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
                      <button key={d} className={`diff-btn${difficulty === d ? ` active ${d}` : ""}`} onClick={() => setDifficulty(d)}>
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
                    {uploadError.split("\n").filter((l: string) => l.trim()).map((line: string, i: number) => <div key={i}>{line}</div>)}
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

          {/* Streaming loading */}
          {isLoading && (
            <div className="stream-card">
              <div className="stream-title">
                {streamingTitle || <span style={{ color: "#C0BAB0" }}>Generating…</span>}
              </div>
              <div className="stream-bar-wrap">
                <div className="stream-bar" style={{ width: `${streamProgress}%` }}></div>
              </div>
              <div className="stream-steps">
                <div className={`stream-step ${streamProgress < 20 ? "active" : "done"}`}>
                  <div className="step-dot"></div>
                  Analyzing your material
                </div>
                <div className={`stream-step ${streamProgress < 20 ? "" : streamProgress < 75 ? "active" : "done"}`}>
                  <div className="step-dot"></div>
                  Building study guide
                </div>
                <div className={`stream-step ${streamProgress < 75 ? "" : streamProgress < 95 ? "active" : "done"}`}>
                  <div className="step-dot"></div>
                  Generating {questionCount} quiz questions
                </div>
                <div className={`stream-step ${streamProgress >= 95 ? "active" : ""}`}>
                  <div className="step-dot"></div>
                  Saving to your history
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          {hasGenerated && !isLoading && (
            <div className="results">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10 }}>
                <div className="tabs" style={{ flex: 1 }}>
                  <button className={`tab-btn${tab === "summary" ? " active" : ""}`} onClick={() => setTab("summary")}>📋 Summary</button>
                  <button className={`tab-btn${tab === "flashcards" ? " active" : ""}`} onClick={() => { setTab("flashcards"); setCardFlipped(false); }}>
                    🃏 Cards
                    {dueCount > 0 && <span className="tab-badge blue">{dueCount}</span>}
                  </button>
                  <button className={`tab-btn${tab === "quiz" ? " active" : ""}`} onClick={() => setTab("quiz")}>🎯 Quiz</button>
                  <button className={`tab-btn${tab === "weakspots" ? " active" : ""}`} onClick={() => setTab("weakspots")}>
                    ⚠️
                    {weakQuestions.length > 0 && <span className="tab-badge">{weakQuestions.length}</span>}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {currentSession?.shareToken && (
                    <button className="header-icon-btn" onClick={copyShare}>{copied ? "✓" : "🔗"}</button>
                  )}
                  <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#aaa" }} onClick={clearAll}>✕ New</button>
                </div>
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
                      <button className="quiz-cta" onClick={() => setTab("flashcards")}>
                        <div>
                          <div className="quiz-cta-title">Study with flashcards</div>
                          <div className="quiz-cta-sub">{concepts.length} cards · spaced repetition enabled</div>
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

              {/* Flashcards Tab — with SRS */}
              {tab === "flashcards" && (
                <div className="fc-card">
                  {concepts.length > 0 ? (
                    <div className="fc-wrap">
                      <div className="fc-top-row">
                        <p className="sum-label" style={{ marginBottom: 0 }}>
                          Flashcards
                          {reviewMode && reviewConcepts.length === 0 && <span style={{ color: "#22C55E", marginLeft: 8 }}>✓ All reviewed!</span>}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="fc-count">
                            {reviewMode ? `${activeCardIndex + 1} / ${reviewConcepts.length || 0}` : `${activeCardIndex + 1} / ${concepts.length}`}
                          </span>
                          {dueCount > 0 && (
                            <button className={`fc-review-btn ${reviewMode ? "on" : "off"}`} onClick={() => { setReviewMode(r => !r); setCardIndex(0); setCardFlipped(false); }}>
                              {reviewMode ? "All cards" : `${dueCount} due`}
                            </button>
                          )}
                        </div>
                      </div>

                      {reviewMode && reviewConcepts.length === 0 ? (
                        <div className="fc-empty">
                          🎉 You're all caught up!<br />No cards due for review right now.<br />
                          <button className="fc-nav-btn" style={{ marginTop: 16, width: "auto", padding: "10px 20px" }} onClick={() => { setReviewMode(false); setCardIndex(0); }}>Browse all cards</button>
                        </div>
                      ) : (
                        <>
                          <div className="fc-dots">
                            {displayCards.map((_, i) => (
                              <div key={i} className="fc-dot"
                                style={{ background: i === activeCardIndex ? "#5B6AF0" : "#EDE9E2" }}
                                onClick={() => { setCardIndex(i); setCardFlipped(false); }} />
                            ))}
                          </div>

                          <div className="fc-container" onClick={() => setCardFlipped(f => !f)}>
                            <div className={`fc-inner${cardFlipped ? " flipped" : ""}`}>
                              <div className="fc-face fc-front">
                                <p className="fc-label" style={{ color: "#C0BAB0" }}>TERM</p>
                                <p className="fc-term">{currentCard?.term}</p>
                                <p className="fc-hint">Tap to reveal definition</p>
                              </div>
                              <div className="fc-face fc-back">
                                <p className="fc-label" style={{ color: "#7B87E8" }}>DEFINITION</p>
                                <p className="fc-def">{currentCard?.definition}</p>
                              </div>
                            </div>
                          </div>

                          {/* SRS rating buttons — shown after flipping */}
                          {cardFlipped ? (
                            <>
                              {currentCardSRS && currentCardSRS.repetitions > 0 && (
                                <p className="fc-srs-info">
                                  Last interval: {currentCardSRS.interval}d · Ease: {currentCardSRS.easeFactor.toFixed(1)}
                                </p>
                              )}
                              <div className="srs-btns">
                                <button className="srs-btn again" onClick={() => rateCard(1)}>
                                  😓 Again<br /><span className="srs-btn-sub">1 day</span>
                                </button>
                                <button className="srs-btn hard" onClick={() => rateCard(2)}>
                                  😐 Hard<br /><span className="srs-btn-sub">+interval</span>
                                </button>
                                <button className="srs-btn good" onClick={() => rateCard(3)}>
                                  🙂 Good<br /><span className="srs-btn-sub">next due</span>
                                </button>
                                <button className="srs-btn easy" onClick={() => rateCard(4)}>
                                  😄 Easy<br /><span className="srs-btn-sub">longer</span>
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="fc-nav">
                              <button className="fc-nav-btn" onClick={prevCard}>← Prev</button>
                              <button className="fc-nav-btn" onClick={nextCard}>Next →</button>
                            </div>
                          )}

                          <p style={{ textAlign: "center", fontSize: 12, color: "#C0BAB0", marginTop: 12 }}>
                            Rate after flipping · SM-2 spaced repetition
                          </p>
                        </>
                      )}

                      <button className="quiz-cta" style={{ margin: "20px 0 0", width: "100%" }} onClick={() => setTab("quiz")}>
                        <div>
                          <div className="quiz-cta-title">Ready to test yourself?</div>
                          <div className="quiz-cta-sub">{totalQ} questions · AI-graded</div>
                        </div>
                        <span style={{ fontSize: 20, color: "#fff", opacity: 0.6 }}>→</span>
                      </button>
                    </div>
                  ) : (
                    <div className="fc-empty">No flashcards available — generate a summary first.</div>
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
                            <button style={{ background: "none", border: "none", fontSize: 13, fontWeight: 600, color: "#5B6AF0", cursor: "pointer", padding: 0, marginTop: 8 }} onClick={() => setTab("weakspots")}>
                              +{weakQuestions.length - 3} more → View all
                            </button>
                          )}
                        </div>
                      )}

                      <div className="score-actions" style={{ marginTop: 24 }}>
                        <button className="act-btn dark" onClick={resetQuiz}>↺ Retry</button>
                        <button className="act-btn light" onClick={() => setTab("flashcards")}>🃏 Cards</button>
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
                                  {q.difficulty && <span className="diff-tag" style={{ background: DIFF_BG[q.difficulty], color: DIFF_COLORS[q.difficulty] }}>{q.difficulty}</span>}
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
                          <p className="q-sec-label">Short Answer — AI Graded</p>
                          {questions.short_answer.map((q, i) => {
                            const s = saStates[i]; if (!s) return null;
                            const scoreClass = !s.result ? "" : s.result.score >= 4 ? "correct" : s.result.score >= 2 ? "partial" : "wrong";
                            const scoreLabelClass = !s.result ? "" : s.result.isCorrect ? "correct" : s.result.score >= 2 ? "partial" : "wrong";
                            return (
                              <div key={i} className="q-block">
                                <p className="q-num">
                                  Question {i + 1}
                                  {q.difficulty && <span className="diff-tag" style={{ background: DIFF_BG[q.difficulty], color: DIFF_COLORS[q.difficulty] }}>{q.difficulty}</span>}
                                  <span style={{ fontStyle: "normal", fontSize: 10, background: "#F0EFFF", color: "#3730A3", padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>AI graded</span>
                                </p>
                                <p className="q-text">{q.question}</p>

                                {!s.result ? (
                                  <div className="sa-input-wrap">
                                    <textarea
                                      className="sa-input"
                                      placeholder="Type your answer here…"
                                      value={s.userAnswer}
                                      disabled={s.grading}
                                      onChange={e => {
                                        const newSa = saStates.map((st, j) => j === i ? { ...st, userAnswer: e.target.value } : st);
                                        setSaStates(newSa);
                                      }}
                                    />
                                    <button className="sa-submit" onClick={() => gradeAnswer(i)} disabled={!s.userAnswer.trim() || s.grading}>
                                      {s.grading ? <><span className="spinner" style={{ borderColor: "#fff", borderTopColor: "transparent" }}></span>Grading…</> : "Submit Answer →"}
                                    </button>
                                  </div>
                                ) : (
                                  <div className={`ai-grade-result ${scoreClass}`}>
                                    <div className="ai-grade-score">
                                      <span className={`ai-score-badge ${scoreLabelClass}`}>
                                        {s.result.score}/5 · {s.result.isCorrect ? "Correct" : s.result.score >= 2 ? "Partial" : "Incorrect"}
                                      </span>
                                    </div>
                                    <p className="ai-feedback">{s.result.feedback}</p>
                                    <p style={{ fontSize: 12, color: "#aaa", marginTop: 6, fontStyle: "italic" }}>Your answer: {s.userAnswer}</p>
                                  </div>
                                )}
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
                      <div className="weak-empty">🎉 No weak spots yet!<br />Complete a quiz to start tracking which questions need more practice.</div>
                    ) : (
                      <>
                        <p style={{ fontSize: 13, color: "#999", marginBottom: 16, lineHeight: 1.5 }}>These questions have tripped you up before. Focus on these next time you study.</p>
                        {weakQuestions.map((w, i) => (
                          <div key={i} className="weak-item">
                            <span className="weak-icon">🔁</span>
                            <div style={{ flex: 1 }}>
                              <div className="weak-q">{w.question}</div>
                              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{w.type === "mc" ? "Multiple choice" : "Short answer"}</div>
                            </div>
                            <span className="weak-count">✗ {w.wrongCount}×</span>
                          </div>
                        ))}
                        <div style={{ marginTop: 16, padding: "12px 14px", background: "#F5F5FF", border: "1px solid #E0E7FF", borderRadius: 10, fontSize: 13, color: "#3730A3", lineHeight: 1.5 }}>
                          💡 <strong>Tip:</strong> Retry the quiz focusing on these questions. They'll be removed once you answer correctly.
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
