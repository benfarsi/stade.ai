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
    const { content, save = true } = await req.json();
    if (!content?.trim()) return NextResponse.json({ error: "No content provided" }, { status: 400 });

    const prompt = `You are an expert study assistant and educator. Analyze the material below and produce a high-quality structured summary that would genuinely help a student understand and remember the content for an exam.

Return ONLY valid JSON with this exact structure:
{
  "title": "specific, descriptive title that captures the main topic",
  "overview": "3-4 sentences that explain what this material covers, why it matters, and what the main argument or theme is. Be specific — mention actual topics, names, or ideas from the material.",
  "key_points": ["full sentence key point", "another key point"],
  "concepts": [
    { "term": "term or concept name", "definition": "clear, thorough definition with context from the material" }
  ],
  "quick_facts": ["short memorable fact", "another fact"]
}

Rules:
- title: Be specific. Not "Biology Notes" but "Cell Membrane Structure and Transport Mechanisms"
- overview: 3-4 sentences. Mention actual content — theories, names, events, processes. No vague generalities.
- key_points: 5-7 points. Each must be a complete, informative sentence that conveys a specific idea, not just a topic label. Include cause/effect, significance, or how things work.
- concepts: 4-8 terms. Pick the most important vocabulary, processes, or frameworks. Definitions should be clear enough to use in an exam answer.
- quick_facts: 3-5 short, punchy, specific facts — numbers, dates, names, formulas, or key distinctions that are easy to memorize and likely to appear on an exam.
- Only use information from the material, no outside knowledge.

[MATERIAL]
${content.slice(0, 14000)}
[END MATERIAL]`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const summary = JSON.parse(response.choices[0].message.content!);
    await incrementAiCalls(user!.id, supabase!);

    let savedId: string | null = null;
    if (save) {
      const { data, error } = await supabase!
        .from("summaries")
        .insert({
          user_id: user!.id,
          title: summary.title,
          source_text: content.slice(0, 25000),
          overview: summary.overview,
          key_points: summary.key_points,
          concepts: summary.concepts,
          quick_facts: summary.quick_facts,
          share_token: nanoid(12),
        })
        .select("id")
        .single();

      if (!error) savedId = data?.id ?? null;
    }

    return NextResponse.json({ summary, savedId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { user, response: authResponse, supabase } = await requireAuth();
  if (authResponse) return authResponse;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const { data, error, count } = await supabase!
    .from("summaries")
    .select("id, title, overview, is_public, share_token, created_at", { count: "exact" })
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ summaries: data, total: count });
}