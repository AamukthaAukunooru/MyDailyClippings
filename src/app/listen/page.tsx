import fs from 'fs'
import path from 'path'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Listen',
}

interface ShowConfig {
  slug: string
  title: string
  description: string
  color: string
}

function loadShows(): { siteUrl: string; shows: ShowConfig[] } {
  const raw = fs.readFileSync(path.join(process.cwd(), 'podcast', 'shows.json'), 'utf-8')
  const parsed = JSON.parse(raw)
  return { siteUrl: parsed.siteUrl.replace(/\/$/, ''), shows: parsed.shows }
}

export default function ListenPage() {
  const { siteUrl, shows } = loadShows()

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 md:px-0">
      <header className="mb-10">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-widest text-gray-500">Listen</span>
        <h1 className="font-serif-display text-4xl font-bold italic text-white md:text-5xl">Clippings, out loud.</h1>
        <p className="mt-4 text-base leading-relaxed text-gray-300">
          Every page is also a podcast episode. Subscribe to each show in a podcast app such as AntennaPod
          (Add podcast, then Add podcast by RSS address) and it plays in Android Auto with skip buttons and
          played/unplayed tracking.
        </p>
      </header>

      <ul className="space-y-4">
        {shows.map((show) => {
          const feed = `${siteUrl}/feeds/${show.slug}.xml`
          return (
            <li key={show.slug} className="flex gap-4 rounded-xl border border-surface-border bg-surface-card p-4">
              <img
                src={`/MyDailyClippings/feeds/art/${show.slug}.png`}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 flex-none rounded-lg"
              />
              <div className="min-w-0">
                <h2 className="font-semibold text-white">{show.title}</h2>
                <p className="text-sm text-gray-400">{show.description}</p>
                <a href={feed} className="mt-1 block break-all font-mono text-xs text-amber-400 hover:underline">
                  {feed}
                </a>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-8 text-sm text-gray-500">
        Subscribe to the category shows only, not a combined feed, so each episode exists once and its played
        state stays consistent. Your app&apos;s episode list already merges them by date.
      </p>
    </div>
  )
}
