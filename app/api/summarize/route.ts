import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { content } = await req.json();
    if (!content?.trim()) return NextResponse.json({ error: "No content provided" }, { status: 400 });

    const prompt = `You are an expert study assistant. Analyze the material below and extract a structured summary.

Return ONLY valid JSON with this exact structure:
{
  "title": "concise title for this material",
  "overview": "2-3 sentence overview of what this material covers",
  "key_points": ["clear, specific key point", "another key point"],
  "concepts": [
    { "term": "term or concept name", "definition": "clear definition or explanation" }
  ],
  "quick_facts": ["short memorable fact", "another fact"]
}

Rules:
- key_points: 4-6 points, each a full sentence summarizing something important
- concepts: 3-6 important terms/concepts worth knowing
- quick_facts: 3-5 short, punchy facts that are easy to memorize
- Only use information from the material, no outside knowledge

[MATERIAL]
${content.slice(0, 12000)}
[END MATERIAL]`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const summary = JSON.parse(response.choices[0].message.content!);
    return NextResponse.json({ summary });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
  }
}