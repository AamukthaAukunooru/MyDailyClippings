import Link from 'next/link'
import type { Newsletter } from '@/lib/types'
import { getCategoryBySlug, ACCENT_CLASSES } from '@/lib/categories'

interface HeroCardProps {
  newsletter: Newsletter
}

export default function HeroCard({ newsletter }: HeroCardProps) {
  const { frontmatter, href, category } = newsletter
  const cat = getCategoryBySlug(category)
  const accent = ACCENT_CLASSES[cat?.accentColor ?? 'violet']
  const story = frontmatter.topStories?.[0]
  const image = story?.image ?? null

  return (
    <Link href={href} className="group relative block h-72 overflow-hidden rounded-xl bg-surface-card md:h-96">
      {/* Background image */}
      {image ? (
        <img
          src={image}
          alt={story?.headline ?? frontmatter.title}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />
      )}

      {/* Overlay */}
      <div className="card-overlay absolute inset-0" />

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <span className={`mb-2 inline-block rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${accent.bg} ${accent.text}`}>
          {cat?.label ?? category}
        </span>
        <h2 className="font-serif-display text-xl font-bold leading-tight text-white group-hover:text-gray-100 md:text-2xl">
          {story?.headline ?? frontmatter.title}
        </h2>
        {story?.summary && (
          <p className="mt-1.5 line-clamp-2 text-sm text-gray-300">{story.summary}</p>
        )}
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
          {story?.source && <span>{story.source}</span>}
          <span>·</span>
          <span>{frontmatter.date}</span>
        </div>
      </div>
    </Link>
  )
}
