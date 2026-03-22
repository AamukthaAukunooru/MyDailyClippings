import Link from 'next/link'
import type { Newsletter } from '@/lib/types'
import type { CategoryMeta } from '@/lib/types'
import { ACCENT_CLASSES } from '@/lib/categories'

interface DigestCardProps {
  newsletter: Newsletter | null
  category: CategoryMeta
}

export default function DigestCard({ newsletter, category }: DigestCardProps) {
  const accent = ACCENT_CLASSES[category.accentColor ?? 'violet']

  if (!newsletter) {
    return (
      <div className="flex flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card">
        <div className={`h-1 w-full ${accent.border} border-t-2`} />
        <div className="flex flex-1 flex-col p-5">
          <span className={`mb-2 self-start text-xs font-semibold uppercase tracking-wider ${accent.text}`}>
            {category.label}
          </span>
          <p className="text-sm text-gray-500">No clippings yet. Check back tomorrow.</p>
        </div>
      </div>
    )
  }

  const story = newsletter.frontmatter.topStories?.[0]
  const image = story?.image ?? null

  return (
    <Link
      href={newsletter.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card transition-colors hover:border-gray-600"
    >
      {/* Accent top line */}
      <div className={`h-0.5 w-full ${accent.bg} border-t-2 ${accent.border}`} />

      {/* Image */}
      {image && (
        <div className="relative h-44 overflow-hidden">
          <img
            src={image}
            alt={story?.headline ?? newsletter.frontmatter.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="card-overlay absolute inset-0" />
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <span className={`mb-3 self-start text-xs font-semibold uppercase tracking-wider ${accent.text}`}>
          {category.label}
        </span>
        <h3 className="font-serif-display flex-1 text-lg font-bold leading-snug text-white group-hover:text-gray-200">
          {story?.headline ?? newsletter.frontmatter.title}
        </h3>
        {newsletter.frontmatter.summary && (
          <p className="mt-2 line-clamp-2 text-sm text-gray-400">{newsletter.frontmatter.summary}</p>
        )}
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span>{newsletter.frontmatter.date}</span>
          <span className="group-hover:text-gray-300">Read →</span>
        </div>
      </div>
    </Link>
  )
}
