import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content, questionCount = 7, difficulty = "mixed" } = body as { content: string; questionCount: number; difficulty: "easy"|"medium"|"hard"|"mixed" };

    if (!content?.trim()) return NextResponse.json({ error: "No content provided" }, { status: 400 });

    const mcCount = Math.round(questionCount * 0.6);
    const saCount = questionCount - mcCount;

    const difficultyGuide = {
      easy: "Questions should test basic recall and definitions. Keep them straightforward.",
      medium: "Questions should test understanding and application of concepts.",
      hard: "Questions should test deep understanding, edge cases, and require synthesizing multiple concepts.",
      mixed: "Mix of easy recall, medium understanding, and hard synthesis questions.",
    }[difficulty] || "Mix of difficulties.";

    const prompt = `You are a university professor writing a rigorous exam. Create high-quality, exam-realistic questions based ONLY on the material below.

Difficulty: ${difficulty.toUpperCase()} — ${difficultyGuide}

Create exactly:
- ${mcCount} multiple choice questions (4 options each)
- ${saCount} short answer questions

Quality requirements:
MULTIPLE CHOICE:
- Wrong options must be plausible — common misconceptions, off-by-one errors, or partial truths. Never obviously wrong.
- Question stem must be clear and unambiguous.
- Test understanding, application, and analysis — not just "what is the definition of X."
- Vary question format: some should present a scenario and ask what would happen, some compare two concepts, some identify an example of a principle.

SHORT ANSWER:
- Questions must require explanation (why, how, what would happen if) — not just "define X."
- Model answer must be 2-4 complete sentences: state the key point, explain the mechanism or reason, give context or significance.
- Include at least one question requiring the student to apply a concept to a new situation.

COVERAGE:
- Spread questions across different sections of the material. Do not cluster on one topic.
- Include questions on any formulas, key numbers, dates, names, or processes mentioned.

Each question must include a "difficulty" field: "easy", "medium", or "hard".

Return ONLY valid JSON:
{
  "multiple_choice": [
    {
      "question": "question text",
      "options": ["option1", "option2", "option3", "option4"],
      "answer": "correct option text (must exactly match one option)",
      "difficulty": "easy" | "medium" | "hard"
    }
  ],
  "short_answer": [
    {
      "question": "question text",
      "answer": "complete 2-4 sentence model answer with explanation",
      "difficulty": "easy" | "medium" | "hard"
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
    return NextResponse.json({ result: structured });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}