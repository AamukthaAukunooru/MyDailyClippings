import type { CategoryMeta } from './types'

export const CATEGORIES: CategoryMeta[] = [
  {
    slug: 'physics',
    label: 'Physics',
    tagline: 'Decoding the architectural blueprints of reality, from the subatomic vibrations of strings to the silent dance of quantum.',
    accentColor: 'cyan',
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
    accentColor: 'orange',
    searchQuery: 'astronomy space telescope discovery exoplanet NASA ESA latest news',
  },
  {
    slug: 'math',
    label: 'Math',
    tagline: 'New results, solved problems and the ideas behind them, without the notation.',
    accentColor: 'violet',
    searchQuery: 'mathematics research proof theorem news latest',
  },
  {
    slug: 'neuroscience',
    label: 'Neuroscience',
    tagline: 'What the latest research says about how brains work, minus the hype.',
    accentColor: 'rose',
    searchQuery: 'neuroscience brain research study news latest',
  },
  {
    slug: 'astronomy-explained',
    label: 'Astronomy Explained',
    tagline: 'One idea about the cosmos each day, built up from first principles.',
    accentColor: 'orange',
    searchQuery: '',
  },
  {
    slug: 'math-explained',
    label: 'Math Explained',
    tagline: 'One mathematical idea each day, with intuition first.',
    accentColor: 'violet',
    searchQuery: '',
  },
  {
    slug: 'neuroscience-explained',
    label: 'Neuroscience Explained',
    tagline: 'One piece of how the brain works, explained each day.',
    accentColor: 'rose',
    searchQuery: '',
  },
  {
    slug: 'history',
    label: 'History Explained',
    tagline: 'One event, person or era each day, told as a story with cause and effect.',
    accentColor: 'green',
    searchQuery: '',
  },
  {
    slug: 'system-design',
    label: 'System Design Explained',
    tagline: 'One system design or software engineering topic each day, with real numbers and trade-offs.',
    accentColor: 'teal',
    searchQuery: '',
  },
  {
    slug: 'watchlist',
    label: 'Watchlist',
    tagline: 'News about the specific things I follow, only when something new happens.',
    accentColor: 'rose',
    searchQuery: '',
  },
  {
    slug: 'questions',
    label: 'Curious Questions',
    tagline: 'Short answers to the questions I wonder about.',
    accentColor: 'indigo',
    searchQuery: '',
  },
]

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug)

export function getCategoryBySlug(slug: string): CategoryMeta | undefined {
  return CATEGORIES.find((c) => c.slug === slug)
}

// Accent color → Tailwind classes map
export const ACCENT_CLASSES: Record<string, { text: string; border: string; bg: string; btnBg: string }> = {
  violet: { text: 'text-violet-400', border: 'border-violet-500', bg: 'bg-violet-500/10', btnBg: 'bg-violet-500' },
  blue:   { text: 'text-blue-400',   border: 'border-blue-500',   bg: 'bg-blue-500/10',   btnBg: 'bg-blue-500' },
  amber:  { text: 'text-amber-400',  border: 'border-amber-500',  bg: 'bg-amber-500/10',  btnBg: 'bg-amber-500' },
  indigo: { text: 'text-indigo-400', border: 'border-indigo-500', bg: 'bg-indigo-500/10', btnBg: 'bg-indigo-500' },
  green:  { text: 'text-green-400',  border: 'border-green-500',  bg: 'bg-green-500/10',  btnBg: 'bg-green-500' },
  rose:   { text: 'text-rose-400',   border: 'border-rose-500',   bg: 'bg-rose-500/10',   btnBg: 'bg-rose-500' },
  teal:   { text: 'text-teal-400',   border: 'border-teal-500',   bg: 'bg-teal-500/10',   btnBg: 'bg-teal-500' },
  orange: { text: 'text-orange-400', border: 'border-orange-500', bg: 'bg-orange-500/10', btnBg: 'bg-orange-500' },
  cyan:   { text: 'text-cyan-400',   border: 'border-cyan-500',   bg: 'bg-cyan-500/10',   btnBg: 'bg-cyan-500' },
}
