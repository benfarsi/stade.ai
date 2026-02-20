import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = input.trim().match(p);
    if (m) return m[1];
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url: string };
    if (!url?.trim()) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: "Could not find a valid YouTube video ID in that URL." }, { status: 400 });
    }

    let transcript;
    try {
      transcript = await YoutubeTranscript.fetchTranscript(videoId);
    } catch {
      return NextResponse.json(
        { error: "No transcript available for this video. Try a video with captions enabled." },
        { status: 422 }
      );
    }

    if (!transcript?.length) {
      return NextResponse.json(
        { error: "Transcript was empty. This video may not have captions." },
        { status: 422 }
      );
    }

    const text = transcript
      .map(seg => seg.text.replace(/\n/g, " ").trim())
      .join(" ")
      .slice(0, 25000);

    return NextResponse.json({ text, success: true });
  } catch (error) {
    console.error("Transcript error:", error);
    return NextResponse.json(
      { error: "Something went wrong fetching the transcript." },
      { status: 500 }
    );
  }
}
