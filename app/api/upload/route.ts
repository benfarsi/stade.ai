import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // Use unpdf - designed for Next.js server environments, no DOM deps
    const { extractText } = await import("unpdf");
    const { totalPages, text } = await extractText(new Uint8Array(arrayBuffer), { mergePages: true });

    console.log(`PDF parsed: ${totalPages} pages, ${text.length} chars`);

    if (!text || text.trim().length < 50) {
      return NextResponse.json(
        { error: "Could not extract enough text from this PDF. It may be a scanned image — try pasting the text manually." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      text: text.slice(0, 25000),
      success: true,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to parse PDF — " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}