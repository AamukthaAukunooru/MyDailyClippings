// Fetch every configured feed and print a Markdown table: items, newest item, or the error.
//   npx tsx scripts/check-feeds.ts
// Exits non-zero when a feed fails or is empty, so a dead URL shows up in the PR checks.

import { ENG_BLOG_FEEDS, NEWS_CATEGORIES } from './categories'
import { fetchFeed, type FeedSource } from './rss'

async function main() {
  const feeds: (FeedSource & { group: string })[] = [
    ...NEWS_CATEGORIES.flatMap((c) => c.feeds.map((f) => ({ ...f, group: c.label }))),
    ...ENG_BLOG_FEEDS.map((f) => ({ ...f, group: `Engineering Blogs (${f.kind})` })),
  ]
  const results = await Promise.allSettled(feeds.map((f) => fetchFeed(f)))
  const rows: string[] = []
  let bad = 0
  results.forEach((r, i) => {
    const f = feeds[i]
    let status: string
    if (r.status === 'rejected') {
      status = `❌ ${String(r.reason).slice(0, 80)}`
      bad++
    } else if (r.value.length === 0) {
      status = '⚠️ no items parsed'
      // Aggregator searches can be legitimately empty on a quiet day.
      if (!f.group.includes('aggregator')) bad++
    } else {
      const newest = r.value.reduce((a, b) => (a.publishedAt > b.publishedAt ? a : b))
      const fullText = r.value.filter((a) => (a.content ?? '').length >= 1500).length
      status = `✅ ${r.value.length} items, newest ${newest.publishedAt.toISOString().slice(0, 10)}, ${fullText} with full text`
    }
    rows.push(`| ${f.group} | ${f.name} | ${status} |`)
  })
  console.log(`## Feed check: ${feeds.length - bad} of ${feeds.length} OK\n`)
  console.log('| Group | Feed | Result |\n| --- | --- | --- |')
  console.log(rows.join('\n'))
  process.exitCode = bad ? 1 : 0
}

main()
