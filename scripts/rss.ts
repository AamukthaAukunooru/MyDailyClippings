// Minimal dependency-free RSS 2.0 / Atom / RDF feed fetching and parsing.
// Feeds are machine-generated XML, so lightweight regex extraction is sufficient
// and avoids adding an npm dependency.

export interface FeedSource {
  name: string
  url: string
}

export interface Article {
  title: string
  url: string
  source: string
  publishedAt: Date
  summary: string
}

const MAX_PER_FEED = 6
const MAX_TOTAL = 40
const MAX_AGE_HOURS = 48
const FETCH_TIMEOUT_MS = 20000

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

function stripHtml(s: string): string {
  return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function firstTag(block: string, tags: string[]): string | null {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
    if (m && m[1].trim()) return m[1].trim()
  }
  return null
}

function extractLink(block: string): string | null {
  // RSS style: <link>https://...</link>
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
  if (rss && rss[1].trim()) return decodeEntities(rss[1].trim())
  // Atom style: <link href="..." rel="alternate"/> — prefer alternate or rel-less
  for (const m of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const href = m[1].match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const rel = m[1].match(/rel=["']([^"']+)["']/i)?.[1]
    if (!rel || rel === 'alternate') return decodeEntities(href)
  }
  return null
}

function parseFeed(xml: string, sourceName: string): Article[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  const articles: Article[] = []
  for (const block of blocks) {
    const title = firstTag(block, ['title'])
    const url = extractLink(block)
    const dateStr = firstTag(block, ['pubDate', 'dc:date', 'published', 'updated'])
    if (!title || !url || !dateStr) continue
    const publishedAt = new Date(stripHtml(dateStr))
    if (isNaN(publishedAt.getTime())) continue
    const rawSummary = firstTag(block, ['description', 'summary', 'content']) ?? ''
    articles.push({
      title: stripHtml(title),
      url,
      source: sourceName,
      publishedAt,
      summary: stripHtml(rawSummary).slice(0, 220),
    })
  }
  return articles
}

async function fetchFeed(feed: FeedSource): Promise<Article[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyDailyClippings/1.0)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseFeed(await res.text(), feed.name)
  } finally {
    clearTimeout(timeout)
  }
}

// Fetch all feeds, keep items from the last 48h, dedupe by URL, newest first.
export async function fetchArticles(feeds: FeedSource[]): Promise<Article[]> {
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000
  const results = await Promise.allSettled(feeds.map(fetchFeed))

  const seen = new Set<string>()
  const articles: Article[] = []
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`  ⚠ Feed failed: ${feeds[i].name} (${result.reason})`)
      return
    }
    const fresh = result.value
      .filter((a) => a.publishedAt.getTime() >= cutoff)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, MAX_PER_FEED)
    console.log(`  ✓ ${feeds[i].name}: ${fresh.length} fresh (of ${result.value.length})`)
    for (const a of fresh) {
      const key = a.url.replace(/[?#].*$/, '').replace(/\/+$/, '')
      if (!seen.has(key)) {
        seen.add(key)
        articles.push(a)
      }
    }
  })

  return articles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, MAX_TOTAL)
}
