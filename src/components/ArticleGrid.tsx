import Link from 'next/link'
import type { Newsletter } from '@/lib/types'
import { getCategoryBySlug, ACCENT_CLASSES } from '@/lib/categories'

interface ArticleGridProps {
  newsletters: Newsletter[]
  title?: string
}

export default function ArticleGrid({ newsletters, title = 'Recent Articles' }: ArticleGridProps) {
  if (newsletters.length === 0) return null

  return (
    <section>
      <h2 className="mb-6 font-serif-display text-xl font-bold text-white md:text-2xl">{title}</h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {newsletters.map((newsletter) => (
          <ArticleCard key={`${newsletter.category}-${newsletter.slug}`} newsletter={newsletter} />
        ))}
      </div>
    </section>
  )
}

function ArticleCard({ newsletter }: { newsletter: Newsletter }) {
  const { frontmatter, href, category } = newsletter
  const cat = getCategoryBySlug(category)
  const accent = ACCENT_CLASSES[cat?.accentColor ?? 'violet']
  const image = frontmatter.topStories?.[0]?.image ?? null

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card transition-colors hover:border-gray-600"
    >
      {/* Image */}
      <div className="relative h-44 overflow-hidden bg-gray-800">
        {image ? (
          <img
            src={image}
            alt={frontmatter.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-gray-700 to-gray-800" />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        <span className={`mb-2 self-start rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${accent.bg} ${accent.text}`}>
          {cat?.label ?? category}
        </span>
        <h3 className="font-serif-display flex-1 text-base font-bold leading-snug text-white group-hover:text-gray-200">
          {frontmatter.topStories?.[0]?.headline ?? frontmatter.title}
        </h3>
        {frontmatter.summary && (
          <p className="mt-2 line-clamp-2 text-xs text-gray-400">{frontmatter.summary}</p>
        )}
        <p className="mt-3 text-xs text-gray-500">{frontmatter.date}</p>
      </div>
    </Link>
  )
}
