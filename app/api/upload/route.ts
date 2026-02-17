import { NextRequest, NextResponse } from "next/server";

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
    if (!file.name.toLowerCase().endsWith(".pdf") && !file.type.includes("pdf")) {
      return NextResponse.json({ error: "Please upload a PDF file." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    let text = "";

    try {
      text = await extractWithUnpdf(arrayBuffer.slice(0));
      console.log(`unpdf extracted: ${text.trim().length} chars`);
    } catch (e) {
      console.log("unpdf failed:", e);
    }

    // Scanned/image PDF — no text layer found
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
      { error: "Failed to parse PDF — " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}