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
