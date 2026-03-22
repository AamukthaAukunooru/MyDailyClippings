export interface TopStory {
  headline: string
  summary?: string
  source: string
  url: string
  image?: string
}

export interface NewsletterFrontmatter {
  title: string
  date: string
  category: string
  summary: string
  topStories: TopStory[]
  sources: string[]
}

export interface Newsletter {
  frontmatter: NewsletterFrontmatter
  content: string
  slug: string        // "2026-03-22"
  category: string
  href: string        // "/physics/2026-03-22"
}

export interface CategoryMeta {
  slug: string
  label: string
  tagline: string
  accentColor: string   // Tailwind color name e.g. "violet", "blue", "amber"
  searchQuery: string
}
