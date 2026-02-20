import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireAuth, checkRateLimit, incrementAiCalls } from "@/lib/auth";
import { nanoid } from "nanoid";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  const { user, response: authResponse, supabase } = await requireAuth();
  if (authResponse) return authResponse;

  const { allowed, reason } = await checkRateLimit(user!.id, supabase!);
  if (!allowed) return NextResponse.json({ error: reason }, { status: 429 });

  try {
    const body = await req.json();
    const {
      content,
      questionCount = 7,
      difficulty = "mixed",
      summaryId = null,
      save = true,
    } = body;

    if (!content?.trim()) return NextResponse.json({ error: "No content provided" }, { status: 400 });

    const mcCount = Math.round(questionCount * 0.6);
    const saCount = questionCount - mcCount;

    const difficultyGuide = {
      easy: "Questions should test basic recall and definitions.",
      medium: "Questions should test understanding and application of concepts.",
      hard: "Questions should test deep understanding and require synthesizing multiple concepts.",
      mixed: "Mix of easy recall, medium understanding, and hard synthesis questions.",
    }[difficulty] || "Mix of difficulties.";

    const prompt = `You are an expert exam writer used by top universities. Create high-quality exam questions based ONLY on the material provided. Questions must be specific, meaningful, and actually test understanding — not surface-level trivia.

Difficulty: ${difficulty.toUpperCase()} — ${difficultyGuide}

Create exactly:
- ${mcCount} multiple choice questions (4 options each)
- ${saCount} short answer questions

Rules for GREAT questions:
- Questions must be specific to the material — no generic questions that could apply to anything
- Multiple choice: Wrong options (distractors) must be plausible — common misconceptions, related but incorrect ideas, or easily confused alternatives. Never use obviously wrong fillers.
- Multiple choice: The correct answer must be unambiguously correct based on the material
- Short answer: Questions should require a 1-3 sentence response demonstrating real understanding. The provided answer should be a model answer a student could compare against.
- Spread questions across different topics/sections of the material — don't cluster on one part
- Vary question types: definitions, cause/effect, comparisons, applications, significance, mechanisms
- The "answer" field for MC must exactly match one of the options strings

Return ONLY valid JSON:
{
  "title": "short title for this quiz",
  "multiple_choice": [
    {
      "question": "specific question text",
      "options": ["option A", "option B", "option C", "option D"],
      "answer": "option A",
      "difficulty": "easy"
    }
  ],
  "short_answer": [
    {
      "question": "specific question text",
      "answer": "clear model answer (2-4 sentences)",
      "difficulty": "medium"
    }
  ]
}

[START MATERIAL]
${content.slice(0, 14000)}
[END MATERIAL]`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const structured = JSON.parse(response.choices[0].message.content!);
    await incrementAiCalls(user!.id, supabase!);

    let savedId: string | null = null;
    if (save) {
      const totalQuestions = (structured.multiple_choice?.length ?? 0) + (structured.short_answer?.length ?? 0);
      const { data, error } = await supabase!
        .from("quizzes")
        .insert({
          user_id: user!.id,
          summary_id: summaryId,
          title: structured.title ?? "Untitled Quiz",
          difficulty,
          multiple_choice: structured.multiple_choice,
          short_answer: structured.short_answer,
          question_count: totalQuestions,
          share_token: nanoid(12),
        })
        .select("id")
        .single();

      if (!error) savedId = data?.id ?? null;
    }

    return NextResponse.json({ result: structured, savedId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { user, response: authResponse, supabase } = await requireAuth();
  if (authResponse) return authResponse;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const { data, error, count } = await supabase!
    .from("quizzes")
    .select("id, title, difficulty, question_count, is_public, share_token, created_at", { count: "exact" })
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quizzes: data, total: count });
}