import Link from 'next/link'
import type { Newsletter } from '@/lib/types'
import type { TopStory } from '@/lib/types'
import { getCategoryBySlug, ACCENT_CLASSES } from '@/lib/categories'

interface SideCardProps {
  newsletter: Newsletter
  storyIndex: number  // which topStory to show (1 or 2)
}

export default function SideCard({ newsletter, storyIndex }: SideCardProps) {
  const { frontmatter, href, category } = newsletter
  const cat = getCategoryBySlug(category)
  const accent = ACCENT_CLASSES[cat?.accentColor ?? 'violet']
  const story: TopStory | undefined = frontmatter.topStories?.[storyIndex]

  return (
    <Link
      href={href}
      className="group relative flex h-[calc(50%-0.5rem)] overflow-hidden rounded-xl bg-surface-card"
    >
      {/* Background image */}
      {story?.image ? (
        <img
          src={story.image}
          alt={story.headline}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-60"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 opacity-60" />
      )}
      <div className="card-overlay absolute inset-0" />

      <div className="relative z-10 flex flex-col justify-end p-4">
        <span className={`mb-1.5 inline-block self-start rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${accent.bg} ${accent.text}`}>
          {story?.source ?? cat?.label}
        </span>
        <h3 className="font-serif-display text-base font-bold leading-snug text-white group-hover:text-gray-100 md:text-lg">
          {story?.headline ?? frontmatter.title}
        </h3>
        <p className="mt-1 text-xs text-gray-400">{frontmatter.date}</p>
      </div>
    </Link>
  )
}
