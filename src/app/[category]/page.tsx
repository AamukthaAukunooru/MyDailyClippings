import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CATEGORIES, getCategoryBySlug, ACCENT_CLASSES } from '@/lib/categories'
import { getNewslettersForCategory } from '@/lib/newsletters'
import HeroCard from '@/components/HeroCard'
import SideCard from '@/components/SideCard'
import ArticleGrid from '@/components/ArticleGrid'

export const dynamicParams = false

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const cat = getCategoryBySlug(category)
  return { title: cat?.label ?? category }
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  const cat = getCategoryBySlug(category)
  if (!cat) notFound()

  const newsletters = getNewslettersForCategory(category)
  const accent = ACCENT_CLASSES[cat.accentColor]

  const latest = newsletters[0] ?? null
  const archive = newsletters.slice(1) // everything after the latest

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      {/* Category header */}
      <header className="mb-10 border-b border-surface-border pb-10">
        <span className={`mb-3 block text-xs font-semibold uppercase tracking-widest ${accent.text}`}>
          Category
        </span>
        <h1 className={`font-serif-display text-5xl font-bold italic text-white md:text-7xl`}>
          {cat.label}.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-gray-400">{cat.tagline}</p>
      </header>

      {newsletters.length === 0 ? (
        <p className="text-gray-500">No clippings yet. Check back tomorrow.</p>
      ) : (
        <>
          {/* Featured: hero + 2 side cards */}
          {latest && (
            <section className="mb-12">
              <div className="flex flex-col gap-4 md:flex-row md:h-96">
                {/* Hero — takes ~60% */}
                <div className="md:w-[60%]">
                  <HeroCard newsletter={latest} />
                </div>
                {/* Side cards — stacked */}
                <div className="flex flex-row gap-4 md:flex-col md:w-[40%]">
                  <SideCard newsletter={latest} storyIndex={1} />
                  <SideCard newsletter={latest} storyIndex={2} />
                </div>
              </div>
            </section>
          )}

          {/* Archive grid */}
          {archive.length > 0 && (
            <ArticleGrid newsletters={archive} title="Recent Articles" />
          )}
        </>
      )}
    </div>
  )
}
