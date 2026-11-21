import { parseFeed } from './rss'
const urls = process.argv.slice(2)
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; MyDailyClippings/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8' }
async function main() {
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: H, redirect: 'follow' })
      const t = await r.text()
      const items = parseFeed(t, 'x')
      const newest = items.length ? items.reduce((a, b) => (a.publishedAt > b.publishedAt ? a : b)).publishedAt.toISOString().slice(0, 10) : '-'
      console.log(`PROBE ${r.status} items=${items.length} newest=${newest} full=${items.filter((a) => (a.content ?? '').length >= 1500).length} ${u} -> ${r.url} ${items[0]?.title ?? t.slice(0, 80).replace(/\s+/g, ' ')}`)
    } catch (e) {
      console.log(`PROBE ERR ${u} ${e}`)
    }
  }
}
main()
