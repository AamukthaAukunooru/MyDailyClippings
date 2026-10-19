import fs from 'fs'
import path from 'path'
import * as yaml from 'js-yaml'
import { QuotaExhaustedError, describeError, generate, generateWithSearch } from './gemini'
import {
  EXPLAINER_CATEGORIES,
  NEWS_CATEGORIES,
  NEWS_SELECTION_RULES,
  PRIORITY_LABEL,
  STYLE_RULES,
  type ExplainerCategory,
  type NewsCategory,
} from './categories'
import { fetchArticles, type Article } from './rss'
import { extractSummary, fetchOgData, resolveAllUrls } from './web'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable is not set')

// Use IST (UTC+5:30) so the date is correct when cron runs at 22:30 UTC (= 4:00 AM IST next day)
const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const today = ist.toISOString().split('T')[0]
const ROOT = process.cwd()
const NEWSLETTERS_DIR = path.join(ROOT, 'newsletters')
const TOPICS_DIR = path.join(ROOT, 'topics')
const FORCE = process.env.FORCE === 'true'
const EDITOR_PASS = process.env.EDITOR_PASS !== 'false'
// Which parts to run: comma list of news,explainers,questions (default all)
const ONLY = new Set((process.env.ONLY || 'news,explainers,questions,watchlist').split(',').map((s) => s.trim()))

const failures: string[] = []
const answeredIssues: string[] = []

interface Draft {
  text: string
  sources: string[]
  topStories: { headline: string; source: string; url: string; image?: string }[]
}

// ---------- shared helpers ----------

function writePage(dir: string, slug: string, front: Record<string, unknown>, text: string): string {
  const out = path.join(NEWSLETTERS_DIR, dir, `${slug}.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const fm = yaml.dump(front, { lineWidth: 120 })
  fs.writeFileSync(out, `---\n${fm}---\n\n${text.trim()}\n`, 'utf-8')
  console.log(`  → ${path.relative(ROOT, out)}`)
  return out
}

function stripFences(text: string): string {
  return text.replace(/^\s*```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim()
}

// Second pass: a careful editor checks the draft. Never fatal: on any problem, keep the draft.
async function editorPass(draft: string, context: string, kind: 'news' | 'explainer' | 'question'): Promise<string> {
  if (!EDITOR_PASS) return draft
  const scope =
    kind === 'news'
      ? `Check the newsletter against the candidate source list below. Remove or soften any claim that the sources do not support and that you are not confident is true. Remove trivial, sensational or crime-blotter items if any slipped in.`
      : `Check the text for factual errors using your own knowledge. Correct anything you are confident is wrong. Where something is uncertain or debated, say so in the text.`
  const prompt = `You are a careful fact-checking editor for a personal newsletter that is also read aloud.
${scope}
Keep the structure, headings, tone and length roughly the same. Do not add new stories or sections.
${STYLE_RULES}
Return ONLY the revised text, with no preamble, notes or explanation.

${context ? `--- CONTEXT ---\n${context}\n\n` : ''}--- DRAFT ---
${draft}`
  try {
    const { text } = await generate(prompt, GEMINI_API_KEY!, { temperature: 0.2, role: 'editor', fallback: false })
    const edited = stripFences(text)
    // Guard against an editor that truncates or rewrites wholesale.
    if (edited.length < draft.length * 0.6 || edited.length > draft.length * 1.4) {
      console.warn(`  ⚠ Editor output length off (${edited.length} vs ${draft.length}); keeping draft`)
      return draft
    }
    console.log('  ✓ Editor pass applied')
    return edited
  } catch (err) {
    console.warn(`  ⚠ Editor pass failed, keeping draft: ${String(err).slice(0, 160)}`)
    return draft
  }
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const reason = describeError(err)
      console.error(`[${label}] attempt ${attempt} failed: ${reason}`)
      const quota = err instanceof QuotaExhaustedError || /429|quota/i.test(reason)
      if (attempt === 2 || quota) {
        failures.push(`${label}: ${reason}`)
        return undefined
      }
    }
  }
  return undefined
}

// ---------- news ----------

const MIN_ARTICLES = 5

function articleList(articles: Article[]): string {
  return articles
    .map(
      (a, i) =>
        `[${i + 1}] (${a.source}, ${a.publishedAt.toISOString().slice(0, 10)}) ${a.title}` +
        (a.summary ? `\n    ${a.summary}` : ''),
    )
    .join('\n')
}

// Primary path: candidate stories come from curated RSS feeds; Gemini selects
// and writes, using search only to add depth on the selected stories.
async function newsFromFeeds(category: NewsCategory): Promise<Draft | null> {
  console.log(`[${category.slug}] Fetching ${category.feeds.length} RSS feeds...`)
  const articles = await fetchArticles(category.feeds)
  console.log(`[${category.slug}] ${articles.length} fresh candidate articles`)
  if (articles.length < (category.minArticles ?? MIN_ARTICLES)) return null

  const list = articleList(articles)
  const userPrompt = `Today is ${today}. Below is a numbered list of candidate stories published in the last 48 hours by hand-picked, trusted sources.

${list}

${NEWS_SELECTION_RULES}

Select the most significant stories (roughly 4-8, fewer on a quiet day) and write today's newsletter around them. You may use Google Search to gather additional detail on the stories you select, but do NOT introduce stories that are not in the list above.
At the very end of your response, on its own line, write "USED:" followed by the numbers of the articles you drew from, e.g. "USED: 1, 4, 7".`

  const { text: rawText } = await generateWithSearch(category.systemPrompt, userPrompt, GEMINI_API_KEY!, 0.3)

  const usedLine = rawText
    .split('\n')
    .reverse()
    .find((l) => /^\s*USED:/i.test(l))
  const usedNums = usedLine
    ? [...new Set((usedLine.match(/\d+/g) ?? []).map(Number))].filter((n) => n >= 1 && n <= articles.length)
    : []
  const used = usedNums.length > 0 ? usedNums.map((n) => articles[n - 1]) : articles.slice(0, 8)
  const draft = rawText
    .split('\n')
    .filter((l) => !/^\s*USED:/i.test(l))
    .join('\n')
    .trim()

  const text = await editorPass(draft, list, 'news')

  const top = used.slice(0, 3)
  const ogResults = await Promise.all(top.map((a) => fetchOgData(a.url)))
  const topStories = top.map((a, i) => ({
    headline: a.title,
    source: new URL(a.url).hostname.replace('www.', ''),
    url: a.url,
    image: ogResults[i].image ?? undefined,
  }))

  return { text, sources: used.map((a) => a.url), topStories }
}

// Fallback path: Gemini search grounding (used when feeds are down or quiet)
async function newsFromSearch(category: NewsCategory): Promise<Draft> {
  const { text: draft, sourceUrls } = await generateWithSearch(
    category.systemPrompt,
    `Today is ${today}. Search for the latest ${category.label} news from the past 24-48 hours and write today's newsletter. Focus on the most significant and recent developments.\n\n${NEWS_SELECTION_RULES}`,
    GEMINI_API_KEY!,
    0.3,
  )
  console.log(`[${category.slug}] Got ${sourceUrls.length} sources from Gemini`)
  const text = await editorPass(draft, '', 'explainer') // no source list to check against: knowledge check

  const resolvedUrls = await resolveAllUrls(sourceUrls)
  const topUrls = resolvedUrls.slice(0, 3)
  const ogResults = await Promise.all(topUrls.map(fetchOgData))
  const topStories = topUrls.map((url, i) => ({
    headline: ogResults[i].title ?? `Article ${i + 1}`,
    source: new URL(url).hostname.replace('www.', ''),
    url,
    image: ogResults[i].image ?? undefined,
  }))
  return { text, sources: resolvedUrls, topStories }
}

async function generateNews(category: NewsCategory) {
  console.log(`\n[${category.slug}] News...`)
  const outputPath = path.join(NEWSLETTERS_DIR, category.slug, `${today}.md`)
  if (fs.existsSync(outputPath) && !FORCE) {
    console.log(`[${category.slug}] Already exists, skipping.`)
    return
  }
  let draft = await newsFromFeeds(category)
  if (!draft) {
    console.log(`[${category.slug}] Too few RSS articles, falling back to search grounding`)
    draft = await newsFromSearch(category)
  }
  writePage(
    category.slug,
    today,
    {
      title: `${category.label} — ${today}`,
      date: today,
      category: category.slug,
      summary: extractSummary(draft.text),
      topStories: draft.topStories,
      sources: draft.sources,
    },
    draft.text,
  )
}

// ---------- explainer series (topics from issues, queue files, or the model) ----------

interface Issue {
  number: number
  title: string
  body: string | null
  html_url: string
  created_at: string
  user: { login: string }
  labels: { name: string }[]
  pull_request?: unknown
}

interface Topic {
  title: string
  details?: string
  issue?: number
  queueLine?: string // set when the topic came from topics/<slug>.md
}

const SITE_URL = 'https://aamukthaaukunooru.github.io/MyDailyClippings'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// The repo owner's open issues, oldest first. Anyone can open issues on a public
// repo, so only the owner's count.
async function ownerIssues(): Promise<Issue[]> {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  if (!repo || !token) {
    console.log('[issues] GITHUB_REPOSITORY/GITHUB_TOKEN not set, skipping issue inbox')
    return []
  }
  const owner = repo.split('/')[0].toLowerCase()
  const all: Issue[] = []
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
    )
    if (!res.ok) throw new Error(`GitHub issues API: HTTP ${res.status}`)
    const batch = (await res.json()) as Issue[]
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all.filter((i) => !i.pull_request && i.user.login.toLowerCase() === owner)
}

function hasLabel(issue: Issue, name: string): boolean {
  return issue.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())
}

// Issues for one series: those labelled `next` first, then oldest first.
function issuesFor(cat: ExplainerCategory, issues: Issue[], used: Set<number>): Issue[] {
  return issues
    .filter((i) => hasLabel(i, cat.issueLabel) && !used.has(i.number))
    .sort((a, b) => Number(hasLabel(b, PRIORITY_LABEL)) - Number(hasLabel(a, PRIORITY_LABEL)))
}

// Topics already covered in this series, from the pages' frontmatter.
function coveredTopics(slug: string): string[] {
  const dir = path.join(NEWSLETTERS_DIR, slug)
  if (!fs.existsSync(dir)) return []
  const topics: string[] = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const m = fs.readFileSync(path.join(dir, file), 'utf-8').match(/^topic:\s*(.+)$/m)
    if (m) topics.push(m[1].replace(/^['"]|['"]$/g, '').trim())
  }
  return topics
}

// Queue file: topics/<slug>.md, one topic per line ("- " bullets optional, # lines ignored).
function nextQueuedTopic(slug: string, covered: string[]): Topic | null {
  const file = path.join(TOPICS_DIR, `${slug}.md`)
  if (!fs.existsSync(file)) return null
  const seen = new Set(covered.map((t) => t.toLowerCase()))
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (line.trim().startsWith('#')) continue
    const title = line.replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/, '').trim()
    if (!title || seen.has(title.toLowerCase())) continue
    return { title, queueLine: line }
  }
  return null
}

function removeQueuedLine(slug: string, line: string) {
  const file = path.join(TOPICS_DIR, `${slug}.md`)
  const lines = fs.readFileSync(file, 'utf-8').split('\n')
  const idx = lines.indexOf(line)
  if (idx >= 0) {
    lines.splice(idx, 1)
    fs.writeFileSync(file, lines.join('\n'), 'utf-8')
  }
}

function longPrompt(cat: ExplainerCategory, topic: Topic | null, covered: string[]): string {
  const choose = topic
    ? `Today's topic: ${topic.title}${topic.details ? `\nWhat I want from it: ${topic.details}` : ''}`
    : `Choose today's topic yourself: something in ${cat.subject} that a curious engineer would love to understand, and that is NOT already covered. Already covered (do not repeat or closely overlap):
${covered.slice(-200).map((t) => `- ${t}`).join('\n') || '- (nothing yet)'}`
  return `You write a daily learning series called "${cat.label} Explained" for My Daily Clippings. Each episode explains one topic in ${cat.subject} from first principles, for a curious software engineer listening during a commute.

${choose}

How to write it:
- About 1,500 to 2,000 words (10 to 15 minutes spoken).
- Open with a hook: a question, a surprising fact or a short story.
- Build intuition first, then the mechanism step by step, then one concrete example, then common misconceptions, then why it matters. End with a three-sentence recap.
- Use 4 to 6 sections with ## headings.
- Short, clear sentences that sound natural read aloud. Use bold for key terms the first time they appear.
${cat.extraGuidance ? `- ${cat.extraGuidance}\n` : ''}- Be accurate. If something is uncertain or debated, say so.
${STYLE_RULES}

On the very first line, write "TOPIC:" followed by a short title for the topic (under 80 characters), then a blank line, then the episode.`
}

function shortPrompt(topic: Topic): string {
  return `You answer curious questions for a personal audio series called "Curious Questions". The listener is a software engineer who loves understanding things from first principles.

Question: ${topic.title}
${topic.details ? `Extra context from the listener: ${topic.details}\n` : ''}
Write a clear, accurate answer of about 500 to 900 words (3 to 6 minutes spoken).
- Start with the short answer in one or two sentences, then explain why, building up from basics.
- Use one everyday analogy or example. Mention a common misconception if there is one.
- Use 2 to 4 sections with ## headings.
- If the question has no settled answer, say what is known and what is debated.
${STYLE_RULES}`
}

async function writeEpisode(cat: ExplainerCategory, topic: Topic | null, covered: string[], slug: string) {
  let title: string
  let text: string
  if (cat.format === 'short') {
    if (!topic) throw new Error('short format needs a topic')
    const { text: raw } = await generate(shortPrompt(topic), GEMINI_API_KEY!, { temperature: 0.4, role: 'explainer' })
    title = topic.title
    text = await editorPass(stripFences(raw), `Question: ${topic.title}`, 'question')
  } else {
    const { text: raw } = await generate(longPrompt(cat, topic, covered), GEMINI_API_KEY!, { temperature: 0.5, role: 'explainer' })
    const lines = stripFences(raw).split('\n')
    const topicIdx = lines.findIndex((l) => /^\s*TOPIC:/i.test(l))
    title =
      (topicIdx >= 0 ? lines[topicIdx].replace(/^\s*TOPIC:\s*/i, '').replace(/\*+/g, '').trim() : '') ||
      topic?.title ||
      `${cat.label} explainer`
    const draft = lines.filter((_, i) => i !== topicIdx).join('\n').trim()
    const words = draft.split(/\s+/).length
    if (words < 600) throw new Error(`Explainer too short (${words} words)`)
    text = await editorPass(draft, `Topic: ${title}`, 'explainer')
  }

  writePage(
    cat.slug,
    slug,
    {
      title: cat.format === 'short' ? title : `${cat.label} Explained: ${title}`,
      date: today,
      category: cat.slug,
      topic: title,
      ...(cat.format === 'short' ? { question: title } : {}),
      ...(topic?.issue ? { issue: topic.issue } : {}),
      summary: extractSummary(text),
      topStories: [],
      sources: [],
    },
    text,
  )
  covered.push(title)
  if (topic?.queueLine !== undefined) removeQueuedLine(cat.slug, topic.queueLine)
  if (topic?.issue) answeredIssues.push(`${topic.issue} ${SITE_URL}/${cat.slug}/${slug}/`)
}

async function generateSeries(cat: ExplainerCategory, issues: Issue[], used: Set<number>) {
  console.log(`\n[${cat.slug}] ${cat.format === 'short' ? 'Questions' : 'Explainer'}...`)
  const covered = coveredTopics(cat.slug)
  const fromIssues = issuesFor(cat, issues, used).slice(0, cat.perDay)

  for (let n = 0; n < cat.perDay; n++) {
    // One-a-day long series keep the familiar <date>.md page name.
    const daily = cat.format === 'long' && cat.perDay === 1
    if (daily && fs.existsSync(path.join(NEWSLETTERS_DIR, cat.slug, `${today}.md`)) && !FORCE) {
      console.log(`[${cat.slug}] Already exists, skipping.`)
      return
    }

    let topic: Topic | null = null
    const issue = fromIssues[n]
    if (issue) {
      used.add(issue.number)
      topic = { title: issue.title.trim(), details: (issue.body ?? '').trim().slice(0, 1500) || undefined, issue: issue.number }
      console.log(`[${cat.slug}] Issue #${issue.number}: ${topic.title}`)
    } else if (cat.format === 'long') {
      topic = nextQueuedTopic(cat.slug, covered)
      if (topic) console.log(`[${cat.slug}] Queued topic: ${topic.title}`)
      else if (!cat.modelPicks) return
      else console.log(`[${cat.slug}] Nothing queued, model picks a topic`)
    } else {
      if (n === 0) console.log(`[${cat.slug}] Nothing queued`)
      return
    }

    const slug = daily ? today : `${today}-${slugify(topic?.title ?? '') || `n${n + 1}`}`
    const label = topic?.issue ? `${cat.slug} #${topic.issue}` : cat.slug
    await withRetry(label, () => writeEpisode(cat, topic, covered, slug))
    if (!topic) return // model-picked: one per day
  }
}

// ---------- watchlist (open issues labelled "watch") ----------
// Each open watch issue is a standing subscription to news about its title.
// Daily: search Google News for each, drop links already reported, and write
// one combined episode only if something new and relevant turned up.

const WATCH_LABEL = 'watch'
const WATCH_DIR = 'watchlist'
const WATCH_SEEN_FILE = path.join(ROOT, 'watchlist', 'seen.json')
const MAX_SEEN_PER_TOPIC = 300

type SeenMap = Record<string, string[]> // issue number -> links already considered

function loadSeen(): SeenMap {
  try {
    return JSON.parse(fs.readFileSync(WATCH_SEEN_FILE, 'utf-8')) as SeenMap
  } catch {
    return {}
  }
}

function saveSeen(seen: SeenMap) {
  fs.mkdirSync(path.dirname(WATCH_SEEN_FILE), { recursive: true })
  fs.writeFileSync(WATCH_SEEN_FILE, JSON.stringify(seen, null, 1) + '\n', 'utf-8')
}

function googleNewsFeed(query: string): string {
  const q = encodeURIComponent(`${query} when:2d`)
  return `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`
}

async function generateWatchlist(issues: Issue[]) {
  console.log('\n[watchlist] Checking watched topics...')
  const watches = issues.filter((i) => hasLabel(i, WATCH_LABEL))
  if (watches.length === 0) {
    console.log('[watchlist] No open watch issues')
    return
  }
  const outputPath = path.join(NEWSLETTERS_DIR, WATCH_DIR, `${today}.md`)
  if (fs.existsSync(outputPath) && !FORCE) {
    console.log('[watchlist] Already exists, skipping.')
    return
  }

  const seen = loadSeen()
  const found: { issue: Issue; articles: Article[] }[] = []
  for (const issue of watches) {
    const query = issue.title.trim()
    const articles = await fetchArticles([{ name: 'Google News', url: googleNewsFeed(query) }])
    const already = new Set(seen[String(issue.number)] ?? [])
    const fresh = articles.filter((a) => !already.has(a.url))
    console.log(`[watchlist] #${issue.number} "${query}": ${fresh.length} new of ${articles.length}`)
    if (fresh.length) found.push({ issue, articles: fresh })
  }
  if (found.length === 0) {
    console.log('[watchlist] Nothing new today, no episode.')
    return
  }

  let n = 0
  const numbered: Article[] = []
  const blocks = found.map(({ issue, articles }) => {
    const focus = (issue.body ?? '').trim().slice(0, 500)
    const lines = articles.map((a) => {
      numbered.push(a)
      n++
      return `[${n}] (${a.source}, ${a.publishedAt.toISOString().slice(0, 10)}) ${a.title}${a.summary ? `\n    ${a.summary}` : ''}`
    })
    return `### Watched topic: ${issue.title.trim()}${focus ? `\nWhat I care about: ${focus}` : ''}\n${lines.join('\n')}`
  })
  const candidateList = blocks.join('\n\n')

  const prompt = `You write a short personal "Watchlist" news update for My Daily Clippings. The listener follows a few specific topics and wants to hear only genuinely new, relevant developments.

Today is ${today}. Below are candidate news items from the last two days, grouped by watched topic.

${candidateList}

Instructions:
- For each watched topic, keep only items that are really about that topic (search results can be loosely related) and that contain actual news. Ignore rumours presented without a source, duplicates and tangential mentions.
- For each topic with real news, write a section with a ## heading (the topic name) and a short, specific summary of what is new: about 80 to 200 words. You may use Google Search to confirm details of these items, but do NOT add news that is not in the list.
- Skip topics with nothing real. Do not mention skipped topics.
- If NO topic has real news, reply with exactly: NO_NEWS
- Start with one sentence saying which topics have updates today.
${STYLE_RULES}
At the very end, on its own line, write "USED:" followed by the numbers of the items you drew from.`

  const { text: raw } = await generate(prompt, GEMINI_API_KEY!, { search: true, temperature: 0.3, role: 'watchlist' })

  // Everything we looked at counts as seen, so tomorrow only brings new links.
  for (const { issue, articles } of found) {
    const key = String(issue.number)
    seen[key] = [...(seen[key] ?? []), ...articles.map((a) => a.url)].slice(-MAX_SEEN_PER_TOPIC)
  }
  saveSeen(seen)

  if (/^\s*NO_NEWS\s*$/i.test(stripFences(raw).replace(/^\s*USED:.*$/gim, '').trim())) {
    console.log('[watchlist] Model found nothing relevant, no episode.')
    return
  }
  const usedLine = raw.split('\n').reverse().find((l) => /^\s*USED:/i.test(l))
  const usedNums = usedLine
    ? [...new Set((usedLine.match(/\d+/g) ?? []).map(Number))].filter((x) => x >= 1 && x <= numbered.length)
    : []
  const used = usedNums.map((x) => numbered[x - 1])
  const draft = stripFences(raw)
    .split('\n')
    .filter((l) => !/^\s*USED:/i.test(l))
    .join('\n')
    .trim()
  const text = await editorPass(draft, candidateList, 'news')
  const topics = found.map((f) => f.issue.title.trim())
  writePage(
    WATCH_DIR,
    today,
    {
      title: `Watchlist — ${today}`,
      date: today,
      category: WATCH_DIR,
      topics,
      summary: extractSummary(text),
      topStories: used.slice(0, 3).map((a) => {
        // Google News titles end with " - Publisher"
        const cut = a.title.lastIndexOf(' - ')
        return cut > 0
          ? { headline: a.title.slice(0, cut), source: a.title.slice(cut + 3), url: a.url }
          : { headline: a.title, source: a.source, url: a.url }
      }),
      sources: used.map((a) => a.url),
    },
    text,
  )
}

// ---------- main ----------

async function main() {
  console.log(`\n✂ My Daily Clippings — generating for ${today}`)

  if (ONLY.has('news')) {
    for (const category of NEWS_CATEGORIES) await withRetry(category.slug, () => generateNews(category))
  }
  const needIssues = ONLY.has('explainers') || ONLY.has('questions') || ONLY.has('watchlist')
  const issues = needIssues ? ((await withRetry('issues', ownerIssues)) ?? []) : []
  if (ONLY.has('explainers') || ONLY.has('questions')) {
    console.log(`\n[issues] ${issues.length} open issue(s) from the owner`)
    const used = new Set<number>()
    for (const cat of EXPLAINER_CATEGORIES) {
      const isQuestions = cat.format === 'short'
      if (isQuestions ? !ONLY.has('questions') : !ONLY.has('explainers')) continue
      await generateSeries(cat, issues, used)
    }
  }
  if (ONLY.has('watchlist')) await withRetry('watchlist', () => generateWatchlist(issues))

  fs.writeFileSync(path.join(ROOT, '.generation-failures.txt'), failures.join('\n'), 'utf-8')
  fs.writeFileSync(path.join(ROOT, '.answered-issues.txt'), answeredIssues.join('\n'), 'utf-8')
  console.log(`\nDone. ${failures.length} failure(s).`)
  if (failures.length) console.log(failures.map((f) => `  ✗ ${f}`).join('\n'))
}

main()
