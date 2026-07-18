import fs from 'fs'
import path from 'path'
import * as yaml from 'js-yaml'
import { generateWithSearch } from './gemini'
import { CATEGORIES, type ScriptCategory } from './categories'
import { fetchArticles } from './rss'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable is not set')

// Use IST (UTC+5:30) so the date is correct when cron runs at 22:30 UTC (= 4:00 AM IST next day)
const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const today = ist.toISOString().split('T')[0]
const NEWSLETTERS_DIR = path.join(process.cwd(), 'newsletters')

// Resolve redirect URLs (e.g. vertexaisearch grounding-api-redirect) to their final destination
async function resolveRedirect(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    // Use HEAD first for speed; fall back to GET if HEAD isn't supported
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyDailyClippings/1.0)' },
    })
    clearTimeout(timeout)
    return res.url // After redirects, this is the final URL
  } catch {
    // If HEAD fails, try GET (some servers reject HEAD)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyDailyClippings/1.0)' },
      })
      clearTimeout(timeout)
      return res.url
    } catch {
      console.warn(`  ⚠ Could not resolve redirect: ${url.substring(0, 80)}...`)
      return url // Fall back to original
    }
  }
}

// Resolve all source URLs, filtering out ones that failed to resolve
async function resolveAllUrls(urls: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    urls.map(async (url) => {
      const final = await resolveRedirect(url)
      // Consider it resolved if the domain changed (i.e. no longer vertexaisearch)
      const didResolve = !final.includes('vertexaisearch.cloud.google.com')
      if (didResolve) {
        console.log(`  ✓ ${new URL(final).hostname}`)
      } else {
        console.log(`  ✗ unresolved: ${url.substring(0, 60)}...`)
      }
      return final
    }),
  )
  return resolved
}

// Fetch OG image and title from a URL
async function fetchOgData(url: string): Promise<{ image: string | null; title: string | null }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyDailyClippings/1.0)' },
    })
    clearTimeout(timeout)

    if (!res.ok) return { image: null, title: null }
    const html = await res.text()

    const imageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)
    const titleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title>([^<]+)<\/title>/i)

    return {
      image: imageMatch?.[1] ?? null,
      title: titleMatch?.[1]?.trim() ?? null,
    }
  } catch {
    return { image: null, title: null }
  }
}

// Extract a summary from the generated text (first substantive paragraph)
function extractSummary(text: string): string {
  const lines = text.split('\n')
  const para = lines.find(
    (l) => l.trim().length > 60 && !l.startsWith('#') && !l.startsWith('*') && !l.startsWith('-'),
  )
  return (para?.trim() ?? '').substring(0, 220)
}

interface NewsletterDraft {
  text: string
  sources: string[]
  topStories: { headline: string; source: string; url: string; image?: string }[]
}

// Minimum fresh RSS articles needed to skip the search-grounding fallback
const MIN_ARTICLES = 5

// Primary path: candidate stories come from curated RSS feeds; Gemini selects
// and writes, using search only to add depth on the selected stories.
async function generateFromFeeds(category: ScriptCategory): Promise<NewsletterDraft | null> {
  console.log(`[${category.slug}] Fetching ${category.feeds.length} RSS feeds...`)
  const articles = await fetchArticles(category.feeds)
  console.log(`[${category.slug}] ${articles.length} fresh candidate articles`)
  if (articles.length < MIN_ARTICLES) return null

  const articleList = articles
    .map(
      (a, i) =>
        `[${i + 1}] (${a.source}, ${a.publishedAt.toISOString().slice(0, 10)}) ${a.title}` +
        (a.summary ? `\n    ${a.summary}` : ''),
    )
    .join('\n')

  const userPrompt = `Today is ${today}. Below is a numbered list of candidate stories published in the last 48 hours by hand-picked, trusted sources.

${articleList}

Select the most significant stories (roughly 4-8, favoring important developments over incremental updates) and write today's newsletter around them. You may use Google Search to gather additional detail on the stories you select, but do NOT introduce stories that are not in the list above.
At the very end of your response, on its own line, write "USED:" followed by the numbers of the articles you drew from, e.g. "USED: 1, 4, 7".`

  const { text: rawText } = await generateWithSearch(category.systemPrompt, userPrompt, GEMINI_API_KEY!)

  // Parse the USED: line to know which curated articles the newsletter cites
  const usedLine = rawText
    .split('\n')
    .reverse()
    .find((l) => /^\s*USED:/i.test(l))
  const usedNums = usedLine
    ? [...new Set((usedLine.match(/\d+/g) ?? []).map(Number))].filter((n) => n >= 1 && n <= articles.length)
    : []
  const used = usedNums.length > 0 ? usedNums.map((n) => articles[n - 1]) : articles.slice(0, 8)
  const text = rawText
    .split('\n')
    .filter((l) => !/^\s*USED:/i.test(l))
    .join('\n')
    .trim()

  const top = used.slice(0, 3)
  const ogResults = await Promise.all(top.map((a) => fetchOgData(a.url)))
  const topStories = top.map((a, i) => ({
    headline: a.title,
    source: new URL(a.url).hostname.replace('www.', ''),
    url: a.url,
    image: ogResults[i].image ?? undefined,
  }))

  return { text, sources: used.map((a) => a.url), topStories }
}

// Fallback path: Gemini free search with grounding (used when feeds are down or quiet)
async function generateFromSearch(category: ScriptCategory): Promise<NewsletterDraft> {
  const { text, sourceUrls } = await generateWithSearch(
    category.systemPrompt,
    `Today is ${today}. Search for the latest ${category.label} news from the past 24-48 hours and write today's newsletter. Focus on the most significant and recent developments.`,
    GEMINI_API_KEY!,
  )

  console.log(`[${category.slug}] Got ${sourceUrls.length} sources from Gemini`)

  console.log(`[${category.slug}] Resolving source URLs...`)
  const resolvedUrls = await resolveAllUrls(sourceUrls)

  const topUrls = resolvedUrls.slice(0, 3)
  const ogResults = await Promise.all(topUrls.map(fetchOgData))

  const topStories = topUrls.map((url, i) => ({
    headline: ogResults[i].title ?? `Article ${i + 1}`,
    source: new URL(url).hostname.replace('www.', ''),
    url,
    image: ogResults[i].image ?? undefined,
  }))

  return { text, sources: resolvedUrls, topStories }
}

async function generateForCategory(category: ScriptCategory) {
  console.log(`\n[${category.slug}] Generating...`)

  const outputPath = path.join(NEWSLETTERS_DIR, category.slug, `${today}.md`)
  if (fs.existsSync(outputPath) && process.env.FORCE !== 'true') {
    console.log(`[${category.slug}] Already exists, skipping.`)
    return
  }

  let draft = await generateFromFeeds(category)
  if (!draft) {
    console.log(`[${category.slug}] Too few RSS articles, falling back to search grounding`)
    draft = await generateFromSearch(category)
  }

  const frontmatterObj = {
    title: `${category.label} — ${today}`,
    date: today,
    category: category.slug,
    summary: extractSummary(draft.text),
    topStories: draft.topStories,
    sources: draft.sources,
  }

  const frontmatterYaml = yaml.dump(frontmatterObj, { lineWidth: 120 })
  const markdown = `---\n${frontmatterYaml}---\n\n${draft.text.trim()}\n`

  const dir = path.join(NEWSLETTERS_DIR, category.slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(outputPath, markdown, 'utf-8')
  console.log(`[${category.slug}] Written to ${outputPath}`)
}

async function main() {
  console.log(`\n✂ My Daily Clippings — generating for ${today}`)

  for (const category of CATEGORIES) {
    try {
      await generateForCategory(category)
    } catch (err) {
      console.error(`[${category.slug}] ERROR:`, err)
      // Continue with other categories
    }
    // 60s delay to stay within free tier RPM limit (5 RPM)
    await new Promise((r) => setTimeout(r, 60000))
  }

  console.log('\nDone.')
}

main()
