import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import type { Newsletter } from '@/lib/types'
import { getCategoryBySlug, ACCENT_CLASSES } from '@/lib/categories'
import TopStoriesRow from './TopStoriesRow'
import Link from 'next/link'

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await remark()
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeHighlight)
    .use(rehypeStringify)
    .process(markdown)
  return result.toString()
}

interface NewsletterContentProps {
  newsletter: Newsletter
}

export default async function NewsletterContent({ newsletter }: NewsletterContentProps) {
  const { frontmatter, content, category } = newsletter
  const cat = getCategoryBySlug(category)
  const accent = ACCENT_CLASSES[cat?.accentColor ?? 'violet']
  const html = await markdownToHtml(content)
  // Strip trailing date from title (e.g. "Physics — 2026-03-25" → "Physics")
  const displayTitle = frontmatter.title
    .replace(/\s*[—–-]+\s*\d{4}-\d{2}-\d{2}\s*$/, '')
    .trim()

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 md:px-0">
      {/* Breadcrumb */}
      <nav className="mb-8 flex items-center gap-2 text-xs text-gray-500">
        <Link href="/" className="hover:text-gray-300">Home</Link>
        <span>/</span>
        <Link href={`/${category}`} className={`hover:text-gray-300 ${accent.text}`}>{cat?.label}</Link>
        <span>/</span>
        <span>{frontmatter.date}</span>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <span className={`mb-3 inline-block text-xs font-semibold uppercase tracking-widest ${accent.text}`}>
          {cat?.label} · Daily Clipping
        </span>
        <h1 className="font-serif-display text-4xl font-bold leading-tight text-white md:text-5xl">
          {displayTitle}
        </h1>
        <p className="mt-2 text-xs text-gray-500">{frontmatter.date}</p>
        {frontmatter.summary && (
          <p className="mt-3 text-lg leading-relaxed text-gray-400">{frontmatter.summary}</p>
        )}
      </header>

      {/* Top stories cards row (like ChatGPT format) */}
      {frontmatter.topStories?.length > 0 && (
        <section className="mb-10">
          <h2 className={`mb-4 text-xs font-semibold uppercase tracking-widest ${accent.text}`}>
            Top Stories
          </h2>
          <TopStoriesRow stories={frontmatter.topStories} />
        </section>
      )}

      {/* Divider */}
      <hr className="mb-10 border-surface-border" />

      {/* Markdown body */}
      <div
        className="prose prose-invert prose-lg max-w-none
          prose-headings:font-serif-display prose-headings:font-bold prose-headings:text-white
          prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
          prose-h3:text-xl prose-h3:mt-8
          prose-p:text-gray-300 prose-p:leading-relaxed
          prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-white
          prose-li:text-gray-300
          prose-code:text-violet-300 prose-code:bg-surface-card prose-code:px-1 prose-code:rounded
          prose-blockquote:border-violet-500 prose-blockquote:text-gray-400"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Sources footer */}
      {frontmatter.sources?.length > 0 && (
        <footer className="mt-12 border-t border-surface-border pt-8">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Sources</h2>
          <ul className="space-y-2">
            {frontmatter.sources.map((url, i) => (
              <li key={i}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-blue-400 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  )
}
