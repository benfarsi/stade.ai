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

    const prompt = `You are a professor creating a comprehensive study guide for a midterm or final exam. Analyze the material below and produce an in-depth, thorough study guide that covers everything a student needs to know to ace an exam on this material.

Return ONLY valid JSON with this exact structure:
{
  "title": "specific, descriptive title",
  "overview": "5-6 sentence overview covering what this material is about, why it matters, the main themes/arguments, and how the topics connect. Be specific — mention actual theories, names, events, or processes.",
  "key_points": ["detailed key point", ...],
  "concepts": [
    { "term": "term", "definition": "thorough definition with context, examples, and significance" }
  ],
  "quick_facts": ["specific memorable fact", ...],
  "exam_tips": ["likely exam question or thing to watch out for", ...]
}

Rules — be THOROUGH:
- title: Specific and descriptive
- overview: 5-6 full sentences. Cover the big picture, main arguments, and why this material matters. Name specific people, events, formulas, or mechanisms.
- key_points: 8-12 points. Each is 1-2 complete sentences explaining a specific idea with its significance, cause/effect, or mechanism. Cover the full breadth of the material — don't cluster on one section.
- concepts: 8-15 terms. Every important vocabulary word, process, theory, or framework. Definitions must be thorough enough to write an exam answer — include what it is, how it works, and why it matters.
- quick_facts: 6-10 punchy facts — specific numbers, dates, names, ratios, formulas, or key distinctions. The kind of details that appear on multiple choice questions.
- exam_tips: 4-6 items. Frame as likely exam questions, common misconceptions, easy-to-confuse pairs, or things students typically miss. E.g. "Know the difference between X and Y" or "Be able to explain why Z happens".
- Only use information from the material provided.

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