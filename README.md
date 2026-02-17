# Stade

> Transform your notes into comprehensive study materials in seconds.

Stade is an AI-powered study tool that takes your lecture notes, textbooks, or any PDF and instantly generates a structured summary and a full quiz — so you can learn faster and test yourself smarter.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?style=flat-square&logo=openai)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)

---

## Features

- **PDF Upload** — drag and drop or browse for any PDF; text is extracted server-side
- **AI Summary** — generates a title, overview, key points, key concepts with definitions, and quick facts
- **Quiz Mode** — multiple choice and short answer questions generated from your material
- **Instant scoring** — lock in answers, get immediate feedback, see your final score
- **Parallel generation** — summary and quiz are generated at the same time so you're not waiting twice
- **Paste support** — no PDF? Just paste your notes directly

---

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router)
- [OpenAI API](https://platform.openai.com/) — `gpt-4o-mini` for question and summary generation
- [unpdf](https://github.com/unjs/unpdf) — server-side PDF text extraction, no DOM dependencies
- TypeScript

---

## Getting Started

### Prerequisites

- Node.js 18+
- An OpenAI API key

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/stade.ai.git
cd stade.ai
npm install
```

### Environment Variables

Create a `.env.local` file in the root of the project:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How It Works

1. **Upload** a PDF or paste your study material
2. Hit **Generate** — Stade calls two AI endpoints in parallel
3. Read through the **Summary** tab to get oriented
4. Switch to **Quiz** and test yourself
5. See your score, retry, or start with new material

---

## Project Structure

```
app/
├── api/
│   ├── generate/route.ts   # Generates MC + short answer questions
│   ├── summarize/route.ts  # Generates structured summary
│   └── upload/route.ts     # Handles PDF upload and text extraction
├── page.tsx                # Main UI
└── layout.tsx
```

---

## Roadmap

- [ ] Flashcard mode
- [ ] Save and revisit past sessions
- [ ] Choose number of questions
- [ ] Export questions as PDF
- [ ] Support for `.docx` and `.txt` uploads

---

## License

MIT