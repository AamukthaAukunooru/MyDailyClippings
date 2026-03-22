import type { CategoryMeta } from './types'

export const CATEGORIES: CategoryMeta[] = [
  {
    slug: 'physics',
    label: 'Physics',
    tagline: 'Decoding the architectural blueprints of reality, from the subatomic vibrations of strings to the silent dance of quantum.',
    accentColor: 'violet',
    searchQuery: 'physics research breakthrough discovery paper latest news',
  },
  {
    slug: 'ai',
    label: 'AI & Technology',
    tagline: 'Observations on the intersection of human cognition, synthetic intelligence, and the tools that reshape our world.',
    accentColor: 'blue',
    searchQuery: 'artificial intelligence machine learning research news latest',
  },
  {
    slug: 'geopolitics',
    label: 'Geopolitics',
    tagline: 'Mapping the shifting tectonic plates of global power, conflict, and diplomacy.',
    accentColor: 'amber',
    searchQuery: 'geopolitics international relations world news latest developments',
  },
  {
    slug: 'astronomy',
    label: 'Astronomy',
    tagline: 'A curated archive of cosmic phenomena, from the birth of distant nebulae to the silent dance of orbital mechanics.',
    accentColor: 'indigo',
    searchQuery: 'astronomy space telescope discovery exoplanet NASA ESA latest news',
  },
]

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug)

export function getCategoryBySlug(slug: string): CategoryMeta | undefined {
  return CATEGORIES.find((c) => c.slug === slug)
}

// Accent color → Tailwind classes map
export const ACCENT_CLASSES: Record<string, { text: string; border: string; bg: string }> = {
  violet: { text: 'text-violet-400', border: 'border-violet-500', bg: 'bg-violet-500/10' },
  blue:   { text: 'text-blue-400',   border: 'border-blue-500',   bg: 'bg-blue-500/10' },
  amber:  { text: 'text-amber-400',  border: 'border-amber-500',  bg: 'bg-amber-500/10' },
  indigo: { text: 'text-indigo-400', border: 'border-indigo-500', bg: 'bg-indigo-500/10' },
  green:  { text: 'text-green-400',  border: 'border-green-500',  bg: 'bg-green-500/10' },
  rose:   { text: 'text-rose-400',   border: 'border-rose-500',   bg: 'bg-rose-500/10' },
  teal:   { text: 'text-teal-400',   border: 'border-teal-500',   bg: 'bg-teal-500/10' },
  orange: { text: 'text-orange-400', border: 'border-orange-500', bg: 'bg-orange-500/10' },
}
