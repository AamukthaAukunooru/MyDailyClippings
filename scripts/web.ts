// Web helpers: resolve grounding redirects, fetch Open Graph data.

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
export async function resolveAllUrls(urls: string[]): Promise<string[]> {
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
export async function fetchOgData(url: string): Promise<{ image: string | null; title: string | null }> {
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
export function extractSummary(text: string): string {
  const lines = text.split('\n')
  const para = lines.find(
    (l) => l.trim().length > 60 && !l.startsWith('#') && !l.startsWith('*') && !l.startsWith('-'),
  )
  return (para?.trim() ?? '').substring(0, 220)
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; MyDailyClippings/1.0)' }

async function getText(url: string, timeoutMs: number): Promise<{ text: string; finalUrl: string } | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: UA })
    if (!res.ok) return null
    return { text: await res.text(), finalUrl: res.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|pre|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// Readable text of a blog post: the <article> (or <main>) element if there is one,
// otherwise the whole body, with scripts, navigation and footers removed.
// Returns '' when the page can't be fetched (paywalls, bot blocks, timeouts).
export async function fetchArticleText(url: string, maxChars = 9000): Promise<string> {
  const page = await getText(url, 15000)
  if (!page) return ''
  const html = page.text
  const pick =
    html.match(/<article\b[\s\S]*<\/article>/i)?.[0] ??
    html.match(/<main\b[\s\S]*<\/main>/i)?.[0] ??
    html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ??
    html
  return htmlToText(pick).slice(0, maxChars)
}

// Given a blog's home page (or a feed URL), return its RSS/Atom feed URL, or null.
export async function discoverFeed(url: string): Promise<string | null> {
  const page = await getText(url, 15000)
  if (!page) return null
  const body = page.text.slice(0, 4000)
  if (/<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(body)) return page.finalUrl // already a feed
  for (const m of page.text.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/rel=["']?alternate/i.test(tag)) continue
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (href) return new URL(href.replace(/&amp;/g, '&'), page.finalUrl).toString()
  }
  return null
}
