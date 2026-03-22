import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { Newsletter, NewsletterFrontmatter } from './types'
import { CATEGORY_SLUGS } from './categories'

const NEWSLETTERS_DIR = path.join(process.cwd(), 'newsletters')

export function getNewsletterBySlug(category: string, date: string): Newsletter | null {
  const filePath = path.join(NEWSLETTERS_DIR, category, `${date}.md`)
  if (!fs.existsSync(filePath)) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)

  const frontmatter = data as NewsletterFrontmatter
  // Ensure arrays exist even if not in file
  if (!frontmatter.topStories) frontmatter.topStories = []
  if (!frontmatter.sources) frontmatter.sources = []

  return {
    frontmatter,
    content: content.trim(),
    slug: date,
    category,
    href: `/${category}/${date}`,
  }
}

export function getNewslettersForCategory(category: string): Newsletter[] {
  const dir = path.join(NEWSLETTERS_DIR, category)
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse() // most recent first

  return files
    .map((file) => getNewsletterBySlug(category, file.replace('.md', '')))
    .filter((n): n is Newsletter => n !== null)
}

export function getLatestForCategory(category: string): Newsletter | null {
  const newsletters = getNewslettersForCategory(category)
  return newsletters.length > 0 ? newsletters[0] : null
}

export function getLatestNewsletter(): Newsletter | null {
  const all = CATEGORY_SLUGS.flatMap((cat) => {
    const latest = getLatestForCategory(cat)
    return latest ? [latest] : []
  })
  if (all.length === 0) return null
  return all.sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date))[0]
}

export function getAllNewsletterParams(): { category: string; date: string }[] {
  return CATEGORY_SLUGS.flatMap((category) =>
    getNewslettersForCategory(category).map((n) => ({
      category,
      date: n.slug,
    }))
  )
}

// Returns today's top story for each category (for digest homepage)
export function getTodaysDigest(): { category: string; newsletter: Newsletter | null }[] {
  return CATEGORY_SLUGS.map((slug) => ({
    category: slug,
    newsletter: getLatestForCategory(slug),
  }))
}
