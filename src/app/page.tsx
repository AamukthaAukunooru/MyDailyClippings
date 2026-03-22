import type { Metadata } from 'next'
import { getTodaysDigest } from '@/lib/newsletters'
import { CATEGORIES } from '@/lib/categories'
import DigestCard from '@/components/DigestCard'

export const metadata: Metadata = {
  title: 'My Daily Clippings',
}

export default function HomePage() {
  const digest = getTodaysDigest()
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      {/* Page header */}
      <div className="mb-10 border-b border-surface-border pb-8">
        <p className="mb-2 text-xs uppercase tracking-widest text-gray-500">{today}</p>
        <h1 className="font-serif-display text-4xl font-bold text-white md:text-6xl">
          Today&apos;s Clippings
        </h1>
        <p className="mt-3 max-w-xl text-gray-400">
          Your daily briefing across science, technology, and world affairs, curated and drafted fresh every morning.
        </p>
      </div>

      {/* Digest grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {digest.map(({ category: slug, newsletter }) => {
          const cat = CATEGORIES.find((c) => c.slug === slug)!
          return (
            <DigestCard key={slug} newsletter={newsletter} category={cat} />
          )
        })}
      </div>
    </div>
  )
}
