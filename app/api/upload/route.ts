import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function extractWithUnpdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(arrayBuffer), { mergePages: true });
  return text || "";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const isImage = file.type.startsWith("image/");
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type.includes("pdf");

    if (!isImage && !isPdf) {
      return NextResponse.json({ error: "Please upload a PDF or image file (PNG, JPG, WEBP)." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // Image: use GPT-4 Vision to extract text
    if (isImage) {
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${file.type};base64,${base64}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: "Extract ALL text from this image exactly as written. Include formulas, labels, diagrams descriptions, annotations, headers, and any other text. Preserve structure. Output only the raw text content." }
          ]
        }],
        max_tokens: 4096,
      });

      const text = response.choices[0].message.content || "";
      if (text.trim().length < 20) {
        return NextResponse.json({ error: "Couldn't extract text from this image. Try a clearer photo with visible text." }, { status: 422 });
      }
      return NextResponse.json({ text: text.slice(0, 25000), success: true });
    }

    // PDF: extract text layer
    let text = "";
    try {
      text = await extractWithUnpdf(arrayBuffer.slice(0));
    } catch (e) {
      console.log("unpdf failed:", e);
    }

    if (text.trim().length < 100) {
      return NextResponse.json(
        {
          error: "This looks like a scanned or image-based PDF — there's no text layer to extract. Try one of these:\n• Use CamScanner's built-in OCR export (exports as searchable text PDF)\n• Copy and paste your notes directly into the text box\n• Type or export your notes as a regular PDF",
          scanned: true,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ text: text.slice(0, 25000), success: true });

  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to process file — " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
