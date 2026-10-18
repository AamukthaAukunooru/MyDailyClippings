// Standalone copy - does NOT import from src/ to avoid Next.js resolution in Node scripts.
// Display config (label, colour, tagline) lives in src/lib/categories.ts;
// audio show config lives in podcast/shows.json.

import type { FeedSource } from './rss'

// Shared rules for everything written; these pages are also read aloud.
export const STYLE_RULES = `Do NOT include a top-level # title (it will be added separately).
Do NOT include YAML frontmatter.
Do NOT use em dashes; use commas or restructure the sentence instead.
Do NOT include tables, code blocks or URLs in the text; this page is also read aloud as audio.
Write numbers and units so they read naturally when spoken.`

// Selection rules for news, to favour significance over noise.
export const NEWS_SELECTION_RULES = `Selection rules:
- Favour developments with lasting significance: new results, decisions, launches, policy changes, major events.
- Skip crime blotter stories, celebrity items, quizzes, listicles, opinion roundups and minor incremental updates.
- Prefer primary sources (journals, agencies, official announcements, original reporting) over aggregators.
- Never invent numbers, quotes or names. If a detail is not in the sources, leave it out.
- Clearly mark anything uncertain or disputed as such.`

export interface NewsCategory {
  kind: 'news'
  slug: string
  label: string
  searchQuery: string
  systemPrompt: string
  // Curated RSS/Atom feeds; generation draws candidate stories from these
  feeds: FeedSource[]
  minArticles?: number // fresh articles needed before falling back to search grounding
}

export interface ExplainerCategory {
  kind: 'explainer'
  slug: string // content dir, e.g. 'history' or 'astronomy-explained'
  label: string // spoken/display label, e.g. 'History'
  subject: string // what the series covers, used in prompts
  extraGuidance?: string
}

export type ScriptCategory = NewsCategory | ExplainerCategory

const newsPrompt = (role: string, tone: string) => `${role} writing a personal daily newsletter called "My Daily Clippings".
${tone}
Structure: start with a brief overview paragraph, then 2-3 sections with ## headers covering different stories or themes.
Use bold for key terms. Be specific: include numbers, names of researchers and institutions.
${STYLE_RULES}
Aim for ~600-800 words.`

export const NEWS_CATEGORIES: NewsCategory[] = [
  {
    kind: 'news',
    slug: 'physics',
    label: 'Physics',
    searchQuery: 'physics research breakthrough discovery paper latest 2026',
    systemPrompt: newsPrompt(
      'You are a science journalist specializing in physics',
      'Write in an authoritative but engaging tone for a technically-literate general audience.',
    ),
    feeds: [
      { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/' },
      { name: 'APS Physics Magazine', url: 'http://feeds.aps.org/rss/recent/physics.xml' },
      { name: 'Phys.org Physics', url: 'https://phys.org/rss-feed/physics-news/' },
      { name: 'ScienceDaily Physics', url: 'https://www.sciencedaily.com/rss/matter_energy/physics.xml' },
      { name: 'New Scientist Physics', url: 'https://www.newscientist.com/subject/physics/feed/' },
    ],
  },
  {
    kind: 'news',
    slug: 'ai',
    label: 'AI & Technology',
    searchQuery: 'artificial intelligence machine learning research product news latest 2026',
    systemPrompt: newsPrompt(
      'You are a technology journalist covering AI and machine learning',
      'Write in a sharp, analytical tone. Distinguish between research papers, product announcements, and industry developments. Use bold for key model names, companies, and technical terms.',
    ),
    feeds: [
      { name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/' },
      { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
      { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
      { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
      { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
      { name: 'Google Research', url: 'https://research.google/blog/rss/' },
      { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
      { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
      { name: 'Hacker News (150+ points)', url: 'https://hnrss.org/frontpage?points=150' },
    ],
  },
  {
    kind: 'news',
    slug: 'geopolitics',
    label: 'Geopolitics',
    searchQuery: 'geopolitics international relations world news major developments latest 2026',
    systemPrompt: newsPrompt(
      'You are a geopolitical analyst',
      'Write in a balanced, factual tone. Present facts and multiple perspectives without strong editorial opinions. Use bold for country names, key figures, and agreements. Organize sections by region or theme.',
    ),
    feeds: [
      { name: 'BBC World', url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
      { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss' },
      { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
      { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
      { name: 'Foreign Policy', url: 'https://foreignpolicy.com/feed/' },
      { name: 'Foreign Affairs', url: 'https://www.foreignaffairs.com/rss.xml' },
      { name: 'The Diplomat', url: 'https://thediplomat.com/feed/' },
      { name: 'DW World', url: 'https://rss.dw.com/rdf/rss-en-world' },
    ],
  },
  {
    kind: 'news',
    slug: 'astronomy',
    label: 'Astronomy',
    searchQuery: 'astronomy space telescope discovery exoplanet NASA ESA SpaceX latest news 2026',
    systemPrompt: newsPrompt(
      'You are a science journalist covering astronomy and space exploration',
      'Write with a sense of wonder balanced with scientific precision. Explain technical concepts accessibly. Include scale, context, and why each discovery matters.',
    ),
    feeds: [
      { name: 'NASA News Releases', url: 'https://www.nasa.gov/news-release/feed/' },
      { name: 'SpaceNews', url: 'https://spacenews.com/feed/' },
      { name: 'Universe Today', url: 'https://www.universetoday.com/feed/' },
      { name: 'EarthSky', url: 'https://earthsky.org/feed/' },
      { name: 'Space.com', url: 'https://www.space.com/feeds/all' },
      { name: 'Phys.org Space', url: 'https://phys.org/rss-feed/space-news/' },
    ],
  },
  {
    kind: 'news',
    slug: 'math',
    label: 'Math',
    searchQuery: 'mathematics research proof breakthrough theorem news latest 2026',
    systemPrompt: newsPrompt(
      'You are a science journalist covering mathematics',
      'Write clearly for a curious engineer. Explain what each result means and why mathematicians care, using intuition rather than notation. Math news is sparse: if there are only a few real stories, write a shorter issue rather than padding.',
    ),
    minArticles: 3,
    feeds: [
      { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/' },
      { name: 'Phys.org Mathematics', url: 'https://phys.org/rss-feed/science-news/mathematics/' },
      { name: 'ScienceDaily Mathematics', url: 'https://www.sciencedaily.com/rss/computers_math/mathematics.xml' },
      { name: "Terence Tao's blog", url: 'https://terrytao.wordpress.com/feed/' },
    ],
  },
  {
    kind: 'news',
    slug: 'neuroscience',
    label: 'Neuroscience',
    searchQuery: 'neuroscience brain research study discovery news latest 2026',
    systemPrompt: newsPrompt(
      'You are a science journalist covering neuroscience',
      'Write for a curious, technically-literate listener. Say whether findings come from human, animal or cell studies, and note sample sizes when they matter. Avoid hype about single studies.',
    ),
    minArticles: 4,
    feeds: [
      { name: 'ScienceDaily Neuroscience', url: 'https://www.sciencedaily.com/rss/mind_brain/neuroscience.xml' },
      { name: 'Medical Xpress Neuroscience', url: 'https://medicalxpress.com/rss-feed/neuroscience-news/' },
      { name: 'Neuroscience News', url: 'https://neurosciencenews.com/feed/' },
      { name: 'The Transmitter', url: 'https://www.thetransmitter.org/feed/' },
      { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/' },
    ],
  },
]

export const EXPLAINER_CATEGORIES: ExplainerCategory[] = [
  {
    kind: 'explainer',
    slug: 'astronomy-explained',
    label: 'Astronomy',
    subject: 'astronomy, astrophysics and space exploration',
  },
  {
    kind: 'explainer',
    slug: 'math-explained',
    label: 'Math',
    subject: 'mathematics: ideas, theorems, famous problems and the intuition behind them',
    extraGuidance: 'Describe formulas in words. Build intuition with small worked examples a listener can follow without paper.',
  },
  {
    kind: 'explainer',
    slug: 'neuroscience-explained',
    label: 'Neuroscience',
    subject: 'neuroscience and how the brain and nervous system work',
  },
  {
    kind: 'explainer',
    slug: 'history',
    label: 'History',
    subject: 'world history, including Indian history: events, people, eras and turning points',
    extraGuidance: 'Tell it as a story with clear cause and effect. Give dates and places. Note where historians disagree.',
  },
  {
    kind: 'explainer',
    slug: 'system-design',
    label: 'System Design',
    subject: 'system design and software engineering: distributed systems, databases, performance, architecture and engineering practice',
    extraGuidance:
      'Pitch it at a senior software engineer. Use concrete numbers and trade-offs, mention real systems that use the idea, and end with how it might come up in a design interview.',
  },
]

// Back-compat name used by older code paths.
export const CATEGORIES: ScriptCategory[] = [...NEWS_CATEGORIES, ...EXPLAINER_CATEGORIES]
