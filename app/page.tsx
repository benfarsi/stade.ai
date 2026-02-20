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
type InputTab = "pdf"|"youtube"|"text";
type TimerOption = 0|600|1200|1800;

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

function getStreak(): { date: string; count: number } {
  try { return JSON.parse(localStorage.getItem("stade_streak") || '{"date":"","count":0}'); } catch { return { date: "", count: 0 }; }
}
function updateStreak(): number {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const s = getStreak();
  const count = s.date === today ? s.count : s.date === yesterday ? s.count + 1 : 1;
  try { localStorage.setItem("stade_streak", JSON.stringify({ date: today, count })); } catch {}
  return count;
}

function checkDueNotification() {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const store = getSRSStore();
    const sessions = getSessions();
    let due = 0;
    sessions.forEach(s => s.summary?.concepts?.forEach(c => {
      const srs = store[termKey(c.term)];
      if (srs && srs.dueDate <= Date.now()) due++;
    }));
    if (due > 0) new Notification("Stade — Cards due", { body: `You have ${due} flashcard${due === 1 ? "" : "s"} due for review. Keep your streak alive!`, icon: "/icon-192.png" });
  } catch {}
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
  const [contentSource, setContentSource] = useState<"pdf"|"text"|"youtube"|"">("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [inputTab, setInputTab] = useState<InputTab>("pdf");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [fetchingTranscript, setFetchingTranscript] = useState(false);

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
  const [timerSetting, setTimerSetting] = useState<TimerOption>(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerActive, setTimerActive] = useState(false);

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
  const [streak, setStreak] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generatingWeakQuiz, setGeneratingWeakQuiz] = useState(false);

  useEffect(() => {
    setSessions(getSessions());
    setSrsStore(getSRSStore());
    setStreak(getStreak().count);
    checkDueNotification();
  }, []);

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

  // Keyboard shortcuts: A/B/C/D or 1/2/3/4 selects the next unanswered MC question
  useEffect(() => {
    if (tab !== "quiz" || quizDone || !questions) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const qi = mcStates.findIndex(s => !s.locked);
      if (qi === -1) return;
      const q = questions!.multiple_choice[qi];
      if (!q) return;
      const map: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, "1": 0, "2": 1, "3": 2, "4": 3 };
      const idx = map[e.key.toLowerCase()];
      if (idx !== undefined && idx < q.options.length) selectMC(qi, q.options[idx]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, quizDone, mcStates, questions]);

  // Countdown timer — auto-submits when time runs out
  useEffect(() => {
    if (!timerActive || timeLeft <= 0) return;
    const id = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(id);
          setTimerActive(false);
          setMcStates(ms => ms.map(s => s.locked ? s : { selected: null, locked: true }));
          setSaStates(ss => ss.map(s => s.result ? s : { ...s, result: { score: 0, isCorrect: false, feedback: "Time expired." } }));
          setQuizDone(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerActive, timeLeft]);

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
    setStreak(updateStreak());
    try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}

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

  async function generateWeakSpotQuiz() {
    const weak = currentSession?.weakQuestions;
    if (!weak?.length || !summary) return;
    setGeneratingWeakQuiz(true);
    const focusContent = `The student struggled with these specific questions and topics. Generate a targeted quiz to help them practice exactly these weak areas.\n\nWeak questions:\n${weak.map(w => `- ${w.question}`).join("\n")}\n\nContext from their study material:\n${summary.overview}\n\nKey concepts: ${summary.concepts?.map(c => `${c.term}: ${c.definition}`).join("; ").slice(0, 4000)}`;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: focusContent, questionCount: Math.min(weak.length * 2, 10), difficulty: "hard" }),
      });
      const data = await res.json();
      if (data.result) {
        setQuestions(data.result);
        setMcStates(data.result.multiple_choice.map(() => ({ selected: null, locked: false })));
        setSaStates(data.result.short_answer.map(() => ({ userAnswer: "", grading: false, result: null })));
        setQuizDone(false);
        setTab("quiz");
      }
    } catch (e) { console.error(e); }
    setGeneratingWeakQuiz(false);
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

  async function fetchTranscript() {
    if (!youtubeUrl.trim()) return;
    setFetchingTranscript(true); setUploadError(""); setContent(""); setContentSource("");
    try {
      const res = await fetch("/api/transcript", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.text) { setUploadError(data.error || "Failed to fetch transcript."); }
      else { setContent(data.text); setContentSource("youtube"); }
    } catch { setUploadError("Error fetching transcript."); }
    setFetchingTranscript(false);
  }

  function clearAll() {
    setContent(""); setContentSource(""); setFileName(""); setUploadError("");
    setSummary(null); setQuestions(null); setHasGenerated(false); setQuizDone(false);
    setCurrentSession(null); setCardIndex(0); setCardFlipped(false);
    setStreamProgress(0); setStreamingTitle(""); setReviewMode(false);
    setYoutubeUrl(""); setFetchingTranscript(false); setInputTab("pdf");
    setTimeLeft(0); setTimerActive(false);
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
    if (timerSetting > 0 && !timerActive && timeLeft === 0) { setTimeLeft(timerSetting); setTimerActive(true); }
  }

  function resetQuiz() {
    if (!questions) return;
    setMcStates(questions.multiple_choice.map(() => ({ selected: null, locked: false })));
    setSaStates(questions.short_answer.map(() => ({ userAnswer: "", grading: false, result: null })));
    setQuizDone(false);
    if (timerSetting > 0) { setTimeLeft(timerSetting); setTimerActive(true); }
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
        body { background: #fff; font-family: 'DM Sans', sans-serif; color: #111; -webkit-font-smoothing: antialiased; }
        .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 72px 48px 100px; }
        .container { width: 100%; max-width: 1100px; }

        .header { text-align: center; margin-bottom: 56px; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 68px; line-height: 1; letter-spacing: -3px; color: #111; }
        .logo em { font-style: italic; color: #5B6AF0; }
        .tagline { font-size: 15px; color: #aaa; margin-top: 6px; margin-bottom: 20px; letter-spacing: 0.01em; }
        .header-btns { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }
        .header-icon-btn { background: none; border: none; font-size: 13px; color: #aaa; cursor: pointer; padding: 0; font-family: 'DM Sans', sans-serif; font-weight: 500; }
        .header-icon-btn:hover { color: #111; }
        .history-btn { display: flex; align-items: center; gap: 6px; background: none; border: none; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: #aaa; cursor: pointer; padding: 0; }
        .history-btn:hover { color: #111; }
        .hist-count { background: #111; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 99px; }

        .history-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.15); z-index: 50; display: flex; justify-content: flex-end; animation: fadeIn 0.15s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .history-panel { width: 340px; height: 100vh; background: #fff; border-left: 1px solid #f0f0f0; display: flex; flex-direction: column; animation: slideIn 0.2s ease; overflow: hidden; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .hist-header { padding: 24px; border-bottom: 1px solid #f5f5f5; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .hist-title { font-family: 'Instrument Serif', serif; font-size: 20px; letter-spacing: -0.3px; color: #111; }
        .hist-close { background: none; border: none; cursor: pointer; font-size: 16px; color: #ccc; padding: 0; line-height: 1; }
        .hist-close:hover { color: #111; }
        .hist-list { flex: 1; overflow-y: auto; padding: 8px; }
        .hist-empty { text-align: center; padding: 40px 24px; color: #ccc; font-size: 13px; line-height: 1.6; }
        .hist-item { padding: 12px 14px; border-bottom: 1px solid #f8f8f8; cursor: pointer; transition: background 0.1s; position: relative; }
        .hist-item:last-child { border-bottom: none; }
        .hist-item:hover { background: #fafafa; }
        .hist-item-title { font-size: 13px; font-weight: 600; color: #111; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 24px; }
        .hist-item-meta { font-size: 12px; color: #bbb; display: flex; align-items: center; gap: 8px; }
        .hist-badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; }
        .hist-badge.score { color: #5B6AF0; }
        .hist-badge.weak { color: #ef4444; }
        .hist-delete { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 13px; color: #ddd; padding: 4px; opacity: 0; transition: opacity 0.1s; }
        .hist-item:hover .hist-delete { opacity: 1; }
        .hist-delete:hover { color: #ef4444; }

        .card { border: 1px solid #ebebeb; border-radius: 12px; padding: 32px; }

        .settings-row { display: flex; gap: 16px; margin-bottom: 20px; }
        .setting-group { flex: 1; }
        .setting-label { font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: #ccc; margin-bottom: 8px; }
        .slider-wrap { display: flex; align-items: center; gap: 10px; }
        .slider { flex: 1; -webkit-appearance: none; appearance: none; height: 2px; border-radius: 99px; background: #eee; outline: none; cursor: pointer; }
        .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #111; cursor: pointer; }
        .slider-val { font-size: 11px; font-weight: 800; color: #111; letter-spacing: 0.04em; }
        .slider-standalone-val { font-size: 13px; font-weight: 700; color: #111; min-width: 20px; text-align: right; }
        .diff-btns { display: flex; gap: 4px; }
        .diff-btn { flex: 1; padding: 6px 4px; border-radius: 6px; border: 1px solid #eee; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 500; cursor: pointer; background: #fafafa; color: #aaa; transition: all 0.1s; text-align: center; }
        .diff-btn.active.easy { background: #f0fdf4; border-color: #86efac; color: #166534; }
        .diff-btn.active.medium { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .diff-btn.active.hard { background: #fff5f5; border-color: #fca5a5; color: #9b1c1c; }
        .diff-btn.active.mixed { background: #f5f5ff; border-color: #c7d2fe; color: #3730a3; }
        .input-src-tabs { display: flex; border-bottom: 1px solid #f0f0f0; margin-bottom: 20px; }
        .input-src-tab { padding: 8px 14px; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; background: none; color: #bbb; letter-spacing: 0.04em; text-transform: uppercase; transition: all 0.15s; }
        .input-src-tab.active { color: #111; border-bottom-color: #111; }
        .input-src-tab:hover:not(.active) { color: #666; }
        .yt-input { flex: 1; padding: 10px 12px; border: 1px solid #e8e8e8; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: #111; background: #fafafa; outline: none; transition: border-color 0.15s; }
        .yt-input:focus { border-color: #111; background: #fff; }
        .yt-input:disabled { opacity: 0.45; }
        .yt-input::placeholder { color: #ccc; }

        .dropzone { border: 1px dashed #ddd; border-radius: 10px; padding: 28px; text-align: center; cursor: pointer; transition: border-color 0.15s; margin-bottom: 16px; }
        .dropzone:hover, .dropzone.active { border-color: #5B6AF0; }
        .dz-icon { width: 34px; height: 34px; background: #f5f5f5; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; }
        .dz-title { font-size: 13px; font-weight: 600; color: #333; margin-bottom: 3px; }
        .dz-sub { font-size: 12px; color: #bbb; }
        .divider { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .divider-line { flex: 1; height: 1px; background: #f0f0f0; }
        .divider-text { font-size: 11px; color: #ccc; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; }
        textarea { width: 100%; height: 140px; border: 1px solid #e8e8e8; border-radius: 8px; padding: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; color: #111; background: #fafafa; resize: none; outline: none; margin-bottom: 12px; transition: border-color 0.15s; }
        textarea::placeholder { color: #ccc; }
        textarea:focus { border-color: #111; background: #fff; }
        textarea:disabled { opacity: 0.4; cursor: not-allowed; }
        .status { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; margin-bottom: 12px; border: 1px solid; }
        .status.success { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
        .status.error { background: #fff5f5; border-color: #fecaca; color: #9b1c1c; }
        .status.info { background: #f5f5ff; border-color: #c7d2fe; color: #3730a3; }
        .status.warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .status.success .status-dot { background: #22c55e; }
        .status.error .status-dot { background: #ef4444; }
        .x-btn { margin-left: auto; background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.35; padding: 0; line-height: 1; color: inherit; }
        .x-btn:hover { opacity: 1; }
        .spinner { width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn { width: 100%; padding: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; transition: opacity 0.15s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .btn-primary { background: #111; color: #fff; }
        .btn-primary:hover:not(:disabled) { opacity: 0.8; }
        .btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }

        .stream-card { border: 1px solid #ebebeb; border-radius: 12px; padding: 36px; }
        .stream-title { font-family: 'Instrument Serif', serif; font-size: 20px; letter-spacing: -0.3px; color: #111; margin-bottom: 20px; min-height: 26px; }
        .stream-bar-wrap { height: 2px; background: #f0f0f0; border-radius: 99px; overflow: hidden; margin-bottom: 20px; }
        .stream-bar { height: 100%; background: #111; border-radius: 99px; transition: width 0.3s ease; }
        .stream-steps { display: flex; flex-direction: column; gap: 10px; }
        .stream-step { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #ccc; }
        .stream-step.active { color: #111; }
        .stream-step.done { color: #22c55e; }
        .step-dot { width: 6px; height: 6px; border-radius: 50%; background: #eee; flex-shrink: 0; }
        .stream-step.active .step-dot { background: #111; animation: pulse 1s infinite; }
        .stream-step.done .step-dot { background: #22c55e; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

        .results { margin-top: 28px; }
        .tabs { display: flex; border-bottom: 1px solid #f0f0f0; margin-bottom: 28px; }
        .tab-btn { flex: 1; padding: 10px 4px; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; background: none; color: #bbb; position: relative; letter-spacing: 0.02em; text-transform: uppercase; }
        .tab-btn.active { color: #111; border-bottom-color: #111; }
        .tab-btn:hover:not(.active) { color: #666; }
        .tab-badge { position: absolute; top: 5px; right: 5px; background: #ef4444; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 99px; line-height: 1.4; }
        .tab-badge.blue { background: #5B6AF0; }

        .sum-card, .quiz-card, .weak-card, .fc-card { border: 1px solid #ebebeb; border-radius: 12px; overflow: hidden; }
        .sum-hero { padding: 36px; border-bottom: 1px solid #f5f5f5; }
        .sum-title { font-family: 'Instrument Serif', serif; font-size: 30px; letter-spacing: -0.5px; color: #111; margin-bottom: 12px; line-height: 1.2; }
        .sum-overview { font-size: 15px; line-height: 1.8; color: #555; }
        .sum-section { padding: 24px 36px; border-bottom: 1px solid #f5f5f5; }
        .sum-section:last-child { border-bottom: none; }
        .sum-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #ccc; margin-bottom: 12px; }
        .key-point { display: flex; gap: 12px; margin-bottom: 10px; font-size: 14px; line-height: 1.65; color: #333; }
        .key-point:last-child { margin-bottom: 0; }
        .kp-dot { width: 4px; height: 4px; border-radius: 50%; background: #ccc; flex-shrink: 0; margin-top: 10px; }
        .concept { padding: 12px 0; border-bottom: 1px solid #f5f5f5; }
        .concept:last-child { border-bottom: none; padding-bottom: 0; }
        .concept-term { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 3px; }
        .concept-def { font-size: 13px; color: #666; line-height: 1.55; }
        .fact { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: #444; line-height: 1.55; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid #f5f5f5; }
        .fact:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
        .quiz-cta { margin: 20px 36px 28px; padding: 16px 20px; background: #fafafa; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border: 1px solid #ebebeb; width: calc(100% - 72px); transition: border-color 0.15s; font-family: 'DM Sans', sans-serif; }
        .quiz-cta:hover { border-color: #111; }
        .quiz-cta-title { font-size: 13px; font-weight: 600; color: #111; margin-bottom: 2px; }
        .quiz-cta-sub { font-size: 12px; color: #aaa; text-align: left; }

        .skeleton { background: linear-gradient(90deg, #f5f5f5 25%, #ebebeb 50%, #f5f5f5 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 4px; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        .quiz-header { padding: 20px 36px; border-bottom: 1px solid #f5f5f5; }
        .progress-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .prog-label { font-size: 10px; font-weight: 600; color: #ccc; letter-spacing: 0.07em; text-transform: uppercase; }
        .prog-count { font-size: 12px; font-weight: 600; color: #aaa; }
        .timer-display { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.03em; }
        .timer-picker-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .timer-picker-label { font-size: 10px; font-weight: 600; color: #ccc; letter-spacing: 0.07em; text-transform: uppercase; flex-shrink: 0; }
        .timer-opt { padding: 4px 10px; border-radius: 6px; border: 1px solid #eee; font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600; cursor: pointer; background: #fafafa; color: #aaa; transition: all 0.1s; }
        .timer-opt.active { background: #f5f5ff; border-color: #c7d2fe; color: #3730a3; }
        .prog-bar { height: 2px; background: #f0f0f0; border-radius: 99px; overflow: hidden; }
        .prog-fill { height: 100%; background: #111; border-radius: 99px; transition: width 0.4s ease; }
        .q-section { padding: 24px 36px; border-bottom: 1px solid #f5f5f5; }
        .q-section:last-child { border-bottom: none; }
        .q-sec-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #ccc; margin-bottom: 16px; }
        .q-block { padding: 16px 0; border-bottom: 1px solid #f8f8f8; }
        .q-block:last-child { border-bottom: none; padding-bottom: 0; }
        .q-block:first-child { padding-top: 0; }
        .q-num { font-size: 11px; font-weight: 600; color: #ccc; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; letter-spacing: 0.05em; text-transform: uppercase; }
        .diff-tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .q-text { font-size: 14px; font-weight: 500; color: #111; line-height: 1.55; margin-bottom: 12px; }
        .options { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
        .opt { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid #ebebeb; font-size: 13px; color: #444; transition: border-color 0.1s; cursor: pointer; background: #fff; user-select: none; }
        .opt:hover:not(.locked) { border-color: #111; color: #111; }
        .opt.locked { cursor: default; }
        .opt.correct { background: #f0fdf4 !important; border-color: #86efac !important; color: #166534 !important; }
        .opt.wrong { background: #fff5f5 !important; border-color: #fca5a5 !important; color: #9b1c1c !important; }
        .opt-letter { font-size: 11px; font-weight: 600; color: #ccc; flex-shrink: 0; padding-top: 2px; min-width: 14px; }
        .feedback { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; margin-top: 4px; }
        .feedback.correct { color: #166534; }
        .feedback.wrong { color: #9b1c1c; }

        .sa-input-wrap { display: flex; flex-direction: column; gap: 8px; }
        .sa-input { width: 100%; padding: 10px 12px; border: 1px solid #e8e8e8; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: #111; background: #fafafa; resize: none; outline: none; height: 72px; transition: border-color 0.15s; line-height: 1.5; }
        .sa-input:focus { border-color: #111; background: #fff; }
        .sa-input:disabled { opacity: 0.45; }
        .sa-submit { align-self: flex-start; padding: 7px 16px; background: #111; color: #fff; border: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; display: flex; align-items: center; gap: 6px; }
        .sa-submit:hover:not(:disabled) { opacity: 0.75; }
        .sa-submit:disabled { opacity: 0.35; cursor: not-allowed; }
        .ai-grade-result { margin-top: 10px; padding: 12px; border-radius: 8px; border: 1px solid #ebebeb; background: #fafafa; }
        .ai-grade-result.correct { background: #f0fdf4; border-color: #bbf7d0; }
        .ai-grade-result.wrong { background: #fff5f5; border-color: #fecaca; }
        .ai-grade-result.partial { background: #fffbeb; border-color: #fde68a; }
        .ai-grade-score { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .ai-score-badge { font-size: 12px; font-weight: 700; }
        .ai-score-badge.correct { color: #166534; }
        .ai-score-badge.wrong { color: #9b1c1c; }
        .ai-score-badge.partial { color: #92400e; }
        .ai-feedback { font-size: 13px; line-height: 1.55; color: #555; }

        .score-screen { padding: 48px 36px 36px; }
        .score-top { text-align: center; margin-bottom: 28px; }
        .score-emoji { font-size: 40px; margin-bottom: 8px; }
        .score-num { font-family: 'Instrument Serif', serif; font-size: 64px; line-height: 1; letter-spacing: -3px; color: #111; margin-bottom: 4px; }
        .score-num span { color: #5B6AF0; }
        .score-sub { font-size: 14px; color: #aaa; margin-bottom: 14px; }
        .score-pills { display: flex; gap: 10px; justify-content: center; margin-bottom: 14px; flex-wrap: wrap; }
        .score-pill { font-size: 12px; font-weight: 600; }
        .score-pill.mc { color: #3730a3; }
        .score-pill.sa { color: #166534; }
        .score-pill.best { color: #92400e; }
        .score-pill.improved { color: #166534; }

        .attempt-history { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
        .attempt-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #ccc; margin-bottom: 12px; }
        .attempt-bars { display: flex; align-items: flex-end; gap: 6px; height: 40px; }
        .attempt-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
        .attempt-bar { width: 100%; border-radius: 2px 2px 0 0; transition: height 0.4s ease; min-height: 2px; }
        .attempt-bar.latest { background: #111; }
        .attempt-bar.past { background: #ddd; }
        .attempt-label { font-size: 10px; color: #ccc; }

        .weak-section { border-top: 1px solid #f5f5f5; padding: 24px 36px; }
        .weak-title { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #ccc; margin-bottom: 14px; }
        .weak-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; border-bottom: 1px solid #f5f5f5; }
        .weak-item:last-child { border-bottom: none; }
        .weak-icon { font-size: 13px; flex-shrink: 0; margin-top: 1px; }
        .weak-q { font-size: 13px; color: #333; line-height: 1.5; flex: 1; }
        .weak-count { font-size: 11px; font-weight: 700; color: #ef4444; flex-shrink: 0; }
        .weak-card-content { padding: 32px; }
        .weak-empty { text-align: center; padding: 36px 24px; color: #ccc; font-size: 13px; line-height: 1.6; }

        .score-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
        .act-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid #ebebeb; transition: opacity 0.15s; background: #fff; color: #111; }
        .act-btn:hover { opacity: 0.7; }
        .act-btn.dark { background: #111; color: #fff; border-color: #111; }

        .fc-wrap { padding: 32px; }
        .fc-top-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 8px; flex-wrap: wrap; }
        .fc-count { font-size: 12px; color: #bbb; }
        .fc-review-btn { padding: 4px 12px; border-radius: 99px; border: 1px solid #ebebeb; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.1s; background: #fafafa; color: #666; }
        .fc-review-btn.on { background: #111; border-color: #111; color: #fff; }
        .fc-dots { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 16px; }
        .fc-dot { width: 6px; height: 6px; border-radius: 50%; cursor: pointer; transition: background 0.2s; flex-shrink: 0; background: #EDE9E2; }
        .fc-dot.active { background: #5B6AF0; }
        .streak-badge { font-size: 12px; font-weight: 700; color: #f97316; letter-spacing: 0.01em; }
        .fc-container { perspective: 1200px; cursor: pointer; width: 100%; margin-bottom: 14px; user-select: none; }
        .fc-inner { position: relative; width: 100%; height: 200px; transform-style: preserve-3d; transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); }
        .fc-inner.flipped { transform: rotateY(180deg); }
        .fc-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; border-radius: 10px; text-align: center; }
        .fc-front { background: #fafafa; border: 1px solid #ebebeb; }
        .fc-back { background: #f5f5ff; border: 1px solid #e0e7ff; transform: rotateY(180deg); }
        .fc-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 12px; color: #ccc; }
        .fc-back .fc-label { color: #a5b4fc; }
        .fc-term { font-family: 'Instrument Serif', serif; font-size: 22px; color: #111; line-height: 1.3; letter-spacing: -0.3px; }
        .fc-def { font-size: 13px; color: #3730a3; line-height: 1.6; }
        .fc-hint { font-size: 11px; color: #ccc; margin-top: 10px; }
        .fc-srs-info { font-size: 11px; color: #ccc; text-align: center; margin-bottom: 10px; }
        .srs-btns { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin-bottom: 10px; }
        .srs-btn { padding: 8px 4px; border-radius: 8px; border: 1px solid #ebebeb; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.1s; text-align: center; line-height: 1.3; background: #fafafa; color: #444; }
        .srs-btn:hover { opacity: 0.7; }
        .srs-btn.again { border-color: #fca5a5; color: #9b1c1c; background: #fff5f5; }
        .srs-btn.hard { border-color: #fde68a; color: #92400e; background: #fffbeb; }
        .srs-btn.good { border-color: #a5b4fc; color: #3730a3; background: #f5f5ff; }
        .srs-btn.easy { border-color: #86efac; color: #166534; background: #f0fdf4; }
        .srs-btn-sub { font-size: 10px; font-weight: 400; opacity: 0.6; }
        .fc-nav { display: flex; gap: 8px; margin-top: 4px; }
        .fc-nav-btn { flex: 1; padding: 9px; border-radius: 8px; border: 1px solid #ebebeb; background: #fff; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: #888; cursor: pointer; transition: border-color 0.1s; }
        .fc-nav-btn:hover { border-color: #111; color: #111; }
        .fc-empty { padding: 40px 24px; text-align: center; color: #ccc; font-size: 13px; line-height: 1.6; }

        /* ── Dark mode ── */
        html.dark body { background: #0d0d0d; color: #e0e0e0; }
        /* Layout */
        html.dark .logo { color: #e0e0e0; }
        html.dark .tagline { color: #555; }
        html.dark .header-icon-btn, html.dark .history-btn { color: #555; }
        html.dark .header-icon-btn:hover, html.dark .history-btn:hover { color: #e0e0e0; }
        html.dark .streak-badge { color: #fb923c; }
        /* Cards */
        html.dark .card { background: #111111; border-color: #232323; }
        html.dark .stream-card { background: #111111; border-color: #232323; }
        html.dark .sum-card, html.dark .quiz-card, html.dark .weak-card, html.dark .fc-card { background: #111111; border-color: #232323; }
        /* History panel */
        html.dark .history-overlay { background: rgba(0,0,0,0.5); }
        html.dark .history-panel { background: #111111; border-color: #232323; }
        html.dark .hist-header { border-bottom-color: #1e1e1e; }
        html.dark .hist-title { color: #e0e0e0; }
        html.dark .hist-close { color: #444; }
        html.dark .hist-item { border-bottom-color: #1a1a1a; }
        html.dark .hist-item:hover { background: #161616; }
        html.dark .hist-item-title { color: #d0d0d0; }
        html.dark .hist-item-meta { color: #555; }
        html.dark .hist-count { background: #e0e0e0; color: #111; }
        /* Input area */
        html.dark .setting-label { color: #444; }
        html.dark .slider-val { color: #e0e0e0; }
        html.dark .slider { background: #272727; }
        html.dark .slider::-webkit-slider-thumb { background: #e0e0e0; }
        html.dark .diff-btn { background: #1a1a1a; border-color: #272727; color: #555; }
        html.dark .input-src-tabs { border-bottom-color: #1e1e1e; }
        html.dark .input-src-tab { color: #444; border-bottom-color: transparent; }
        html.dark .input-src-tab.active { color: #e0e0e0; border-bottom-color: #e0e0e0; }
        html.dark .input-src-tab:hover:not(.active) { color: #888; }
        html.dark .dropzone { border-color: #2a2a2a; background: #0f0f0f; }
        html.dark .dropzone:hover, html.dark .dropzone.active { border-color: #5B6AF0; }
        html.dark .dz-icon { background: #1a1a1a; }
        html.dark .dz-title { color: #aaa; }
        html.dark .dz-sub { color: #444; }
        html.dark textarea, html.dark .sa-input { background: #161616; border-color: #272727; color: #e0e0e0; }
        html.dark textarea:focus, html.dark .sa-input:focus { border-color: #555; background: #1a1a1a; }
        html.dark textarea::placeholder, html.dark .sa-input::placeholder { color: #333; }
        html.dark .yt-input { background: #161616; border-color: #272727; color: #e0e0e0; }
        html.dark .yt-input:focus { border-color: #555; background: #1a1a1a; }
        html.dark .yt-input::placeholder { color: #333; }
        html.dark .divider-line { background: #1e1e1e; }
        html.dark .btn-primary { background: #e0e0e0; color: #111; }
        html.dark .sa-submit { background: #333; color: #e0e0e0; border: 1px solid #444; }
        html.dark .sa-submit:hover:not(:disabled) { background: #444; }
        /* Streaming */
        html.dark .stream-title { color: #e0e0e0; }
        html.dark .stream-bar-wrap { background: #1e1e1e; }
        html.dark .stream-bar { background: #e0e0e0; }
        html.dark .stream-step { color: #333; }
        html.dark .stream-step.active { color: #e0e0e0; }
        html.dark .stream-step.active .step-dot { background: #e0e0e0; }
        html.dark .step-dot { background: #272727; }
        /* Tabs */
        html.dark .tabs { border-bottom-color: #1e1e1e; }
        html.dark .tab-btn { color: #3a3a3a; }
        html.dark .tab-btn.active { color: #e0e0e0; border-bottom-color: #e0e0e0; }
        html.dark .tab-btn:hover:not(.active) { color: #777; }
        /* Study guide */
        html.dark .sum-hero { border-bottom-color: #1e1e1e; }
        html.dark .sum-section { border-bottom-color: #1e1e1e; }
        html.dark .sum-title { color: #e0e0e0; }
        html.dark .sum-overview { color: #777; }
        html.dark .sum-label { color: #333; }
        html.dark .key-point { color: #777; }
        html.dark .kp-dot { background: #333; }
        html.dark .concept { border-bottom-color: #1e1e1e; }
        html.dark .concept-term { color: #d0d0d0; }
        html.dark .concept-def { color: #666; }
        html.dark .fact { color: #666; border-bottom-color: #1e1e1e; }
        html.dark .quiz-cta { background: #161616; border-color: #272727; }
        html.dark .quiz-cta:hover { border-color: #555; }
        html.dark .quiz-cta-title { color: #e0e0e0; }
        html.dark .quiz-cta-sub { color: #444; }
        /* Flashcards */
        html.dark .fc-front { background: #161616; border-color: #272727; }
        html.dark .fc-back { background: #0f0f20; border-color: #1e1e4a; }
        html.dark .fc-term { color: #e0e0e0; }
        html.dark .fc-def { color: #a5b4fc; }
        html.dark .fc-label { color: #333; }
        html.dark .fc-back .fc-label { color: #4a4a8a; }
        html.dark .fc-hint { color: #333; }
        html.dark .fc-srs-info { color: #444; }
        html.dark .fc-dot { background: #272727; }
        html.dark .fc-dot.active { background: #5B6AF0; }
        html.dark .fc-count { color: #444; }
        html.dark .fc-review-btn { background: #1a1a1a; border-color: #272727; color: #666; }
        html.dark .fc-review-btn.on { background: #e0e0e0; border-color: #e0e0e0; color: #111; }
        html.dark .fc-nav-btn { background: #161616; border-color: #272727; color: #666; }
        html.dark .fc-nav-btn:hover { border-color: #555; color: #e0e0e0; }
        html.dark .srs-btn { background: #161616; border-color: #272727; color: #666; }
        html.dark .srs-btn.again { background: #200f0f; border-color: #5a1a1a; color: #f87171; }
        html.dark .srs-btn.hard { background: #201a0f; border-color: #5a3a0f; color: #fbbf24; }
        html.dark .srs-btn.good { background: #0f0f20; border-color: #2e2e6a; color: #818cf8; }
        html.dark .srs-btn.easy { background: #0f200f; border-color: #1a4a1a; color: #4ade80; }
        /* Quiz */
        html.dark .quiz-header { border-bottom-color: #1e1e1e; }
        html.dark .prog-label { color: #333; }
        html.dark .prog-bar { background: #1e1e1e; }
        html.dark .prog-fill { background: #e0e0e0; }
        html.dark .prog-count { color: #555; }
        html.dark .timer-picker-label { color: #333; }
        html.dark .timer-opt { background: #161616; border-color: #272727; color: #444; }
        html.dark .timer-opt.active { background: #0f0f20; border-color: #3730a3; color: #818cf8; }
        html.dark .q-section { border-bottom-color: #1e1e1e; }
        html.dark .q-sec-label { color: #333; }
        html.dark .q-block { border-bottom-color: #161616; }
        html.dark .q-num { color: #333; }
        html.dark .q-text { color: #d0d0d0; }
        html.dark .opt { background: #161616; border-color: #272727; color: #777; }
        html.dark .opt:hover:not(.locked) { border-color: #555; color: #e0e0e0; }
        html.dark .opt-letter { color: #333; }
        html.dark .feedback.correct { color: #4ade80; }
        html.dark .feedback.wrong { color: #f87171; }
        html.dark .sa-input { background: #161616; border-color: #272727; color: #d0d0d0; }
        html.dark .ai-grade-result { background: #161616; border-color: #272727; }
        html.dark .ai-grade-result.correct { background: #0a1f0a; border-color: #1a4a1a; }
        html.dark .ai-grade-result.wrong { background: #1f0a0a; border-color: #4a1a1a; }
        html.dark .ai-grade-result.partial { background: #1f1a0a; border-color: #4a3a0a; }
        html.dark .ai-score-badge.correct { color: #4ade80; }
        html.dark .ai-score-badge.wrong { color: #f87171; }
        html.dark .ai-score-badge.partial { color: #fbbf24; }
        html.dark .ai-feedback { color: #777; }
        /* Score screen */
        html.dark .score-num { color: #e0e0e0; }
        html.dark .score-num span { color: #818cf8; }
        html.dark .score-sub { color: #555; }
        html.dark .score-pill.mc { color: #818cf8; }
        html.dark .score-pill.sa { color: #4ade80; }
        html.dark .score-pill.best { color: #fbbf24; }
        html.dark .score-pill.improved { color: #4ade80; }
        html.dark .attempt-history { background: #111111; border-color: #1e1e1e; }
        html.dark .attempt-bar.latest { background: #e0e0e0; }
        html.dark .attempt-bar.past { background: #2a2a2a; }
        html.dark .attempt-label { color: #333; }
        html.dark .act-btn { background: #161616; border-color: #272727; color: #aaa; }
        html.dark .act-btn:hover { opacity: 0.8; }
        html.dark .act-btn.dark { background: #e0e0e0; color: #111; border-color: #e0e0e0; }
        /* Weak spots */
        html.dark .weak-section { border-top-color: #1e1e1e; }
        html.dark .weak-title { color: #333; }
        html.dark .weak-item { border-bottom-color: #1a1a1a; }
        html.dark .weak-q { color: #888; }
        html.dark .weak-card-content { background: #111111; }
        html.dark .weak-empty { color: #333; }

        @media (max-width: 520px) {
          .page { padding: 36px 20px 80px; }
          .logo { font-size: 44px; letter-spacing: -1.5px; }
          .header { margin-bottom: 36px; }
          .settings-row { flex-direction: column; gap: 12px; }
          .card { padding: 20px; }
          .stream-card { padding: 22px; }
          .sum-hero { padding: 22px; }
          .sum-section { padding: 18px 22px; }
          .sum-title { font-size: 22px; }
          .quiz-header { padding: 16px 22px; }
          .q-section { padding: 18px 22px; }
          .score-num { font-size: 52px; letter-spacing: -2px; }
          .score-screen { padding: 28px 22px 22px; }
          .weak-card-content { padding: 20px; }
          .weak-section { padding: 18px 22px; }
          .quiz-cta { margin: 16px 22px 20px; width: calc(100% - 44px); }
          .fc-wrap { padding: 20px; }
          .fc-inner { height: 170px; }
          .fc-term { font-size: 18px; }
          .history-panel { width: 100%; }
          .act-btn { padding: 9px 14px; font-size: 12px; }
          .tab-btn { font-size: 10px; }
          .srs-btns { gap: 4px; }
          .srs-btn { font-size: 11px; padding: 7px 2px; }
        }
      `}</style>

      <main className="page">
        <div className="container">
          <div className="header">
            <h1 className="logo">Stad<em>e</em></h1>
            <p className="tagline">Turn your notes into exam-ready questions, instantly.</p>
            <div className="header-btns">
              {streak > 0 && <span className="streak-badge">🔥 {streak} day{streak === 1 ? "" : "s"}</span>}
              <button className="header-icon-btn" onClick={() => setDarkMode(d => !d)}>
                {darkMode ? "Light" : "Dark"}
              </button>
              <button className="history-btn" onClick={() => setShowHistory(true)}>
                History
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
                  <div className="setting-label">Questions — <span className="slider-val">{questionCount}</span></div>
                  <div className="slider-wrap">
                    <input type="range" className="slider" min={3} max={25} value={questionCount}
                      onChange={e => setQuestionCount(Number(e.target.value))} />
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

              {/* Input source tabs */}
              <div className="input-src-tabs">
                {(["pdf","youtube","text"] as InputTab[]).map(t => (
                  <button key={t} className={`input-src-tab${inputTab === t ? " active" : ""}`}
                    onClick={() => { setInputTab(t); if (content && contentSource && contentSource !== t) clearAll(); }}>
                    {t === "pdf" ? "PDF" : t === "youtube" ? "YouTube" : "Text"}
                  </button>
                ))}
              </div>

              {/* PDF */}
              {inputTab === "pdf" && (
                <>
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
                </>
              )}

              {/* YouTube */}
              {inputTab === "youtube" && (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <input type="url" className="yt-input"
                      placeholder="https://youtube.com/watch?v=…"
                      value={youtubeUrl}
                      disabled={fetchingTranscript || contentSource === "youtube"}
                      onChange={e => setYoutubeUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") fetchTranscript(); }}
                    />
                    <button className="sa-submit" style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                      onClick={fetchTranscript}
                      disabled={!youtubeUrl.trim() || fetchingTranscript || contentSource === "youtube"}>
                      {fetchingTranscript ? "Loading…" : "Load →"}
                    </button>
                  </div>
                  {uploadError && inputTab === "youtube" && (
                    <div className="status error" style={{ marginBottom: 12 }}>
                      <span className="status-dot"></span>{uploadError}
                      <button className="x-btn" onClick={() => setUploadError("")}>✕</button>
                    </div>
                  )}
                  {content && contentSource === "youtube" && (
                    <div className="status success">
                      <span className="status-dot"></span>
                      ▶ Transcript loaded · {(content.length / 1000).toFixed(1)}k chars
                      <button className="x-btn" onClick={clearAll}>✕</button>
                    </div>
                  )}
                  {!content && !uploadError && (
                    <p style={{ fontSize: 12, color: "#bbb" }}>Paste any YouTube URL. Works on videos with captions enabled.</p>
                  )}
                </>
              )}

              {/* Text */}
              {inputTab === "text" && (
                <textarea
                  placeholder="Paste lecture notes, textbook excerpts, or any study material…"
                  value={contentSource === "text" || contentSource === "" ? content : ""}
                  onChange={(e) => { setContent(e.target.value); setContentSource(e.target.value ? "text" : ""); }}
                />
              )}

              <button className="btn btn-primary" onClick={generateAll} disabled={isLoading || !content || uploading || fetchingTranscript}>
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
                  <button className={`tab-btn${tab === "summary" ? " active" : ""}`} onClick={() => setTab("summary")}>Study Guide</button>
                  <button className={`tab-btn${tab === "flashcards" ? " active" : ""}`} onClick={() => { setTab("flashcards"); setCardFlipped(false); }}>
                    Flashcards
                    {dueCount > 0 && <span className="tab-badge blue">{dueCount}</span>}
                  </button>
                  <button className={`tab-btn${tab === "quiz" ? " active" : ""}`} onClick={() => setTab("quiz")}>Practice</button>
                  <button className={`tab-btn${tab === "weakspots" ? " active" : ""}`} onClick={() => setTab("weakspots")}>
                    Weak Spots
                    {weakQuestions.length > 0 && <span className="tab-badge">{weakQuestions.length}</span>}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {currentSession?.shareToken && (
                    <button className="header-icon-btn" onClick={copyShare}>{copied ? "Copied" : "Share"}</button>
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
                          <div className="quiz-cta-sub">{concepts.length} cards · spaced repetition</div>
                        </div>
                        <span style={{ fontSize: 16, color: "#aaa" }}>→</span>
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
                              <div key={i} className={`fc-dot${i === activeCardIndex ? " active" : ""}`}
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
                          <div className="quiz-cta-title">Take the quiz</div>
                          <div className="quiz-cta-sub">{totalQ} questions · AI-graded</div>
                        </div>
                        <span style={{ fontSize: 16, color: "#aaa" }}>→</span>
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
                        <button className="act-btn dark" onClick={resetQuiz}>Retry</button>
                        <button className="act-btn" onClick={() => setTab("flashcards")}>Flashcards</button>
                        <button className="act-btn" onClick={clearAll}>New Material</button>
                      </div>
                    </div>
                  ) : questions ? (
                    <>
                      <div className="quiz-header">
                        {totalAnswered === 0 && !timerActive && (
                          <div className="timer-picker-row">
                            <span className="timer-picker-label">Timer</span>
                            <div style={{ display: "flex", gap: 4 }}>
                              {([0, 600, 1200, 1800] as TimerOption[]).map(t => (
                                <button key={t} className={`timer-opt${timerSetting === t ? " active" : ""}`}
                                  onClick={() => setTimerSetting(t)}>
                                  {t === 0 ? "Off" : t === 600 ? "10m" : t === 1200 ? "20m" : "30m"}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="progress-row">
                          <span className="prog-label">Progress</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {timerActive && timeLeft > 0 && (
                              <span className="timer-display" style={{ color: timeLeft <= 60 ? "#ef4444" : "#aaa" }}>
                                ⏱ {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
                              </span>
                            )}
                            <span className="prog-count">{totalAnswered} / {totalQ}</span>
                          </div>
                        </div>
                        <div className="prog-bar">
                          <div className="prog-fill" style={{ width: `${totalQ > 0 ? (totalAnswered / totalQ) * 100 : 0}%` }}></div>
                        </div>
                        <p style={{ fontSize: 11, color: "#ccc", marginTop: 8 }}>Press A / B / C / D to answer the next multiple choice question</p>
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
                                    <p style={{ fontSize: 12, color: "#666", marginTop: 8, lineHeight: 1.55 }}><strong>Model answer:</strong> {q.answer}</p>
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
                      <div className="weak-empty">No weak spots yet.<br />Complete a quiz to start tracking which questions need more practice.</div>
                    ) : (
                      <>
                        <p style={{ fontSize: 13, color: "#999", marginBottom: 16, lineHeight: 1.5 }}>These questions have tripped you up before. A targeted quiz will focus specifically on these gaps.</p>
                        {weakQuestions.map((w, i) => (
                          <div key={i} className="weak-item">
                            <div style={{ flex: 1 }}>
                              <div className="weak-q">{w.question}</div>
                              <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{w.type === "mc" ? "Multiple choice" : "Short answer"} · missed {w.wrongCount}×</div>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={generateWeakSpotQuiz}
                          disabled={generatingWeakQuiz}
                          style={{ marginTop: 20, width: "100%", padding: "12px", background: "#111", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: generatingWeakQuiz ? "not-allowed" : "pointer", opacity: generatingWeakQuiz ? 0.5 : 1, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          {generatingWeakQuiz ? <><span className="spinner" style={{ borderColor: "#fff", borderTopColor: "transparent" }}></span>Generating…</> : `Practice ${weakQuestions.length} weak spots →`}
                        </button>
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
