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
      <div className={`flex min-h-[240px] flex-col rounded-xl border-2 ${accent.border} bg-surface-card p-5`}>
        <span className={`mb-3 self-start text-xs font-semibold uppercase tracking-wider ${accent.text}`}>
          {category.label}
        </span>
        <p className="text-sm text-gray-500">No clippings yet. Check back tomorrow.</p>
      </div>
    )
  }

  const story = newsletter.frontmatter.topStories?.[0]

  return (
    <Link
      href={newsletter.href}
      className={`group flex min-h-[240px] flex-col justify-between rounded-xl border-2 ${accent.border} bg-surface-card p-5 transition-opacity hover:opacity-90`}
    >
      {/* Top */}
      <div>
        <span className={`mb-3 inline-block text-xs font-semibold uppercase tracking-wider ${accent.text}`}>
          {category.label}
        </span>
        <h3 className="font-serif-display text-lg font-bold leading-snug text-white">
          {story?.headline ?? newsletter.frontmatter.title}
        </h3>
        {newsletter.frontmatter.summary && (
          <p className="mt-2 line-clamp-3 text-sm text-gray-400">{newsletter.frontmatter.summary}</p>
        )}
      </div>

      {/* Bottom */}
      <div className="mt-4 flex items-center justify-between">
        <span className={`text-xs font-medium ${accent.text}`}>{newsletter.frontmatter.date}</span>
        <span className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${accent.btnBg}`}>
          Read →
        </span>
      </div>
    </Link>
  )
}
