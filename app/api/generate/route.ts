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

    const prompt = `You are an expert exam creator. Create questions based ONLY on the material provided.

Difficulty: ${difficulty.toUpperCase()} — ${difficultyGuide}

Create:
- ${mcCount} multiple choice questions (4 options each)
- ${saCount} short answer questions

Each question must include a "difficulty" field: "easy", "medium", or "hard".

Return ONLY valid JSON:
{
  "multiple_choice": [
    {
      "question": "question text",
      "options": ["option1", "option2", "option3", "option4"],
      "answer": "correct option text",
      "difficulty": "easy" | "medium" | "hard"
    }
  ],
  "short_answer": [
    {
      "question": "question text",
      "answer": "answer text",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

[START MATERIAL]
${content.slice(0, 12000)}
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