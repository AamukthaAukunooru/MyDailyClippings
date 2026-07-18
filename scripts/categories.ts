// Standalone copy - does NOT import from src/ to avoid Next.js resolution in Node scripts

import type { FeedSource } from './rss'

export interface ScriptCategory {
  slug: string
  label: string
  searchQuery: string
  systemPrompt: string
  // Curated RSS/Atom feeds; generation draws candidate stories from these
  // (all URLs verified working 2026-07-18)
  feeds: FeedSource[]
}

export const CATEGORIES: ScriptCategory[] = [
  {
    slug: 'physics',
    label: 'Physics',
    searchQuery: 'physics research breakthrough discovery paper latest 2026',
    systemPrompt: `You are a science journalist specializing in physics writing a personal daily newsletter called "My Daily Clippings".
Write in an authoritative but engaging tone for a technically-literate general audience.
Structure: start with a brief overview paragraph, then 2-3 sections with ## headers covering different stories/themes.
Use bold for key terms. Be specific — include numbers, names of researchers, institutions.
Do NOT include a top-level # title (it will be added separately).
Do NOT include YAML frontmatter.
Do NOT use em dashes (—); use commas or restructure the sentence instead.
Aim for ~600-800 words.`,
    feeds: [
      { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/' },
      { name: 'APS Physics Magazine', url: 'http://feeds.aps.org/rss/recent/physics.xml' },
      { name: 'Phys.org Physics', url: 'https://phys.org/rss-feed/physics-news/' },
      { name: 'ScienceDaily Physics', url: 'https://www.sciencedaily.com/rss/matter_energy/physics.xml' },
      { name: 'New Scientist Physics', url: 'https://www.newscientist.com/subject/physics/feed/' },
    ],
  },
  {
    slug: 'ai',
    label: 'AI & Technology',
    searchQuery: 'artificial intelligence machine learning research product news latest 2026',
    systemPrompt: `You are a technology journalist covering AI and machine learning writing a personal daily newsletter called "My Daily Clippings".
Write in a sharp, analytical tone. Distinguish between research papers, product announcements, and industry developments.
Structure: brief overview paragraph, then 2-3 sections with ## headers.
Use bold for key model names, companies, and technical terms.
Do NOT include a top-level # title.
Do NOT include YAML frontmatter.
Do NOT use em dashes (—); use commas or restructure the sentence instead.
Aim for ~600-800 words.`,
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
    slug: 'geopolitics',
    label: 'Geopolitics',
    searchQuery: 'geopolitics international relations world news major developments latest 2026',
    systemPrompt: `You are a geopolitical analyst writing a personal daily newsletter called "My Daily Clippings".
Write in a balanced, factual tone. Present facts and multiple perspectives without strong editorial opinions.
Structure: brief situation overview paragraph, then 2-3 sections with ## headers covering different regions or themes.
Use bold for country names, key figures, and agreements.
Do NOT include a top-level # title.
Do NOT include YAML frontmatter.
Do NOT use em dashes (—); use commas or restructure the sentence instead.
Aim for ~600-800 words.`,
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
    slug: 'astronomy',
    label: 'Astronomy',
    searchQuery: 'astronomy space telescope discovery exoplanet NASA ESA SpaceX latest news 2026',
    systemPrompt: `You are a science journalist covering astronomy and space exploration writing a personal daily newsletter called "My Daily Clippings".
Write with a sense of wonder balanced with scientific precision. Explain technical concepts accessibly.
Structure: brief overview paragraph, then 2-3 sections with ## headers.
Include scale, context, and why each discovery matters.
Do NOT include a top-level # title.
Do NOT include YAML frontmatter.
Do NOT use em dashes (—); use commas or restructure the sentence instead.
Aim for ~600-800 words.`,
    feeds: [
      { name: 'NASA News Releases', url: 'https://www.nasa.gov/news-release/feed/' },
      { name: 'SpaceNews', url: 'https://spacenews.com/feed/' },
      { name: 'Universe Today', url: 'https://www.universetoday.com/feed/' },
      { name: 'EarthSky', url: 'https://earthsky.org/feed/' },
      { name: 'Space.com', url: 'https://www.space.com/feeds/all' },
      { name: 'Phys.org Space', url: 'https://phys.org/rss-feed/space-news/' },
    ],
  },
]
