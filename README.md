# My Daily Clippings

Your personal AI newspaper, delivering fresh daily briefings across Physics, AI, Geopolitics, Astronomy, and more — every morning.

## What it is

My Daily Clippings is a personal newspaper built for one reader. Every morning at 6 AM IST, an AI agent scans the latest developments across your chosen topics and drafts a curated briefing in the style of a personal journal.

In an age where algorithms decide what you see based on what keeps you scrolling, this works differently. **You choose the subjects that expand your mind. The AI just does the reading.**

## How it works

1. **Gather** — For each category, the pipeline fetches curated RSS feeds from trusted sources (Quanta, NASA, BBC, NYT, OpenAI, DeepMind and more — see `feeds` in `scripts/categories.ts`) and collects stories published in the last 48 hours.
2. **Generate** — A GitHub Actions workflow runs daily at 6 AM IST, passing the candidate stories to Gemini 2.5 Flash, which selects the most significant ones and writes each newsletter (using web search only to add depth). If feeds are unavailable, it falls back to pure search grounding. Results are committed to the `newsletters/` folder.
3. **Deploy** — Every push to `master` triggers a second workflow that builds the Next.js static site and publishes it to GitHub Pages.

## Tech stack

- [Next.js 15](https://nextjs.org/) — static site export
- [Gemini 2.5 Flash](https://deepmind.google/technologies/gemini/) — newsletter generation with web search grounding
- [GitHub Actions](https://github.com/features/actions) — daily generation + deployment automation
- [GitHub Pages](https://pages.github.com/) — hosting

## Self-hosting

1. Fork this repo
2. Go to **Settings → Secrets → Actions** and add:
   - `GEMINI_API_KEY` — your key from [Google AI Studio](https://aistudio.google.com/)
3. Go to **Settings → Pages → Source** and set it to **GitHub Actions**
4. Push any change to `master` to trigger the first deploy
5. The daily generation will run automatically at 6 AM IST

## Adding categories

Edit two files:

**`scripts/categories.ts`** — add generation config (system prompt, search query, curated RSS feeds)

**`src/lib/categories.ts`** — add display config (label, accent color, tagline)

## Local development

```bash
npm install
npm run dev        # start dev server at localhost:3000
npm run generate   # run newsletter generation locally (requires GEMINI_API_KEY env var)
npm run build      # build static site to ./out
```
