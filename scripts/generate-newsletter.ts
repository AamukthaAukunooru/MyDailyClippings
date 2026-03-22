import fs from 'fs'
import path from 'path'
import * as yaml from 'js-yaml'
import { generateWithSearch } from './gemini'
import { CATEGORIES } from './categories'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable is not set')

const today = new Date().toISOString().split('T')[0] // "2026-03-22"
const NEWSLETTERS_DIR = path.join(process.cwd(), 'newsletters')

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

async function generateForCategory(category: (typeof CATEGORIES)[0]) {
  console.log(`\n[${category.slug}] Generating...`)

  const outputPath = path.join(NEWSLETTERS_DIR, category.slug, `${today}.md`)
  if (fs.existsSync(outputPath) && process.env.FORCE !== 'true') {
    console.log(`[${category.slug}] Already exists, skipping.`)
    return
  }

  // 1. Generate with Gemini + Google Search grounding
  const { text, sourceUrls } = await generateWithSearch(
    category.systemPrompt,
    `Today is ${today}. Search for the latest ${category.label} news from the past 24-48 hours and write today's newsletter. Focus on the most significant and recent developments.`,
    GEMINI_API_KEY!,
  )

  console.log(`[${category.slug}] Got ${sourceUrls.length} sources from Gemini`)

  // 2. Fetch OG data for top 3 source URLs
  const topUrls = sourceUrls.slice(0, 3)
  const ogResults = await Promise.all(topUrls.map(fetchOgData))

  const topStories = topUrls.map((url, i) => ({
    headline: ogResults[i].title ?? `Article ${i + 1}`,
    source: new URL(url).hostname.replace('www.', ''),
    url,
    image: ogResults[i].image ?? undefined,
  }))

  // 3. Build frontmatter
  const frontmatterObj = {
    title: `${category.label} — ${today}`,
    date: today,
    category: category.slug,
    summary: extractSummary(text),
    topStories,
    sources: sourceUrls,
  }

  const frontmatterYaml = yaml.dump(frontmatterObj, { lineWidth: 120 })
  const markdown = `---\n${frontmatterYaml}---\n\n${text.trim()}\n`

  // 4. Write file
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
