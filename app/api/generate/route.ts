import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = body.content;

    console.log("Generate request - content length:", content?.length);
    console.log("Generate request - content preview:", content?.slice(0, 200));

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "No content provided" },
        { status: 400 }
      );
    }

    const prompt = `
You are an expert exam creator. Your ONLY job is to create questions based EXACTLY on the material provided.

CRITICAL RULES:
1. Only use the exact material between the [START MATERIAL] and [END MATERIAL] markers
2. NEVER use outside knowledge or information
3. NEVER invent topics that aren't in the material
4. If material is unclear, ask for clarification - do NOT make assumptions
5. Questions MUST be answerable using ONLY the provided material

Create:
- 4 multiple choice questions (4 options each)
- 3 short answer questions

Return ONLY valid JSON with this structure:
{
  "multiple_choice": [
    {
      "question": "question text",
      "options": ["option1", "option2", "option3", "option4"],
      "answer": "correct option"
    }
  ],
  "short_answer": [
    {
      "question": "question text",
      "answer": "answer text"
    }
  ]
}

[START MATERIAL]
${content.slice(0, 12000)}
[END MATERIAL]

Now create questions based ONLY on the material above.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const structured = JSON.parse(
      response.choices[0].message.content!
    );

    return NextResponse.json({
      result: structured,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
