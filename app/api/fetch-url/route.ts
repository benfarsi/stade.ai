import { NextRequest, NextResponse } from "next/server";

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url: string };
    if (!url?.trim()) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

    let fetchUrl = url.trim();
    if (!fetchUrl.startsWith("http")) fetchUrl = "https://" + fetchUrl;

    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Couldn't fetch that page (${res.status}). Try copying and pasting the text instead.` },
        { status: 422 }
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return NextResponse.json(
        { error: "That URL doesn't contain readable text. Try a news article, Wikipedia page, or course notes URL." },
        { status: 422 }
      );
    }

    const html = await res.text();
    const text = stripHtml(html);

    if (text.length < 100) {
      return NextResponse.json({ error: "Not enough text found on that page." }, { status: 422 });
    }

    return NextResponse.json({ text: text.slice(0, 25000), success: true });
  } catch (error) {
    console.error("Fetch URL error:", error);
    return NextResponse.json(
      { error: "Couldn't reach that URL. The site may block external requests — try copying the text instead." },
      { status: 500 }
    );
  }
}
