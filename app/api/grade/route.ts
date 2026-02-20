import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireAuth } from "@/lib/auth";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  try {
    const { question, correctAnswer, userAnswer } = await req.json();

    if (!userAnswer?.trim()) {
      return NextResponse.json({ score: 0, isCorrect: false, feedback: "No answer provided." });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `You are grading a student's short answer on an exam.

Question: ${question}
Correct answer: ${correctAnswer}
Student's answer: ${userAnswer}

Grade the student on a 0-5 scale:
- 5: Perfect, correct and complete
- 4: Mostly correct, minor omissions
- 3: Partially correct, got the main idea but missing key details
- 2: Shows some understanding but mostly incorrect
- 1: Attempted but significantly wrong
- 0: No answer or completely irrelevant

Return ONLY valid JSON:
{ "score": <0-5>, "isCorrect": <true if score >= 3>, "feedback": "<1-2 sentences: what they got right, what they missed>" }`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content!);
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to grade answer" }, { status: 500 });
  }
}
