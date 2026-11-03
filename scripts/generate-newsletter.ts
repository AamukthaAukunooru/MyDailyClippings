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
import { skyReport } from './sky'
import * as vault from './vault'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable is not set')

// Use IST (UTC+5:30) so the date is correct when cron runs at 22:30 UTC (= 4:00 AM IST next day)
const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
const today = ist.toISOString().split('T')[0]
const ROOT = process.cwd()
const NEWSLETTERS_DIR = path.join(ROOT, 'newsletters')
const TOPICS_DIR = path.join(ROOT, 'topics')
const FORCE = process.env.FORCE === 'true'
// Off by default: on the free tier it would double the Gemini calls (see gemini.ts).
const EDITOR_PASS = process.env.EDITOR_PASS === 'true'
// Which parts to run: comma list of news,explainers,questions,watchlist,headlines (default all)
const ONLY = new Set((process.env.ONLY || 'news,explainers,questions,watchlist,headlines').split(',').map((s) => s.trim()))

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
  vaultNote?: string // set when the topic came from the vault's Podcast/<note>.md
  vaultLine?: string
  dialogue?: boolean // an "Interview:" line: write a two-voice mock interview
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

// The repeatable answer template each mock interview teaches, by kind.
const INTERVIEW_TEMPLATES = {
  'system-design': {
    who: 'a classic system design interview',
    steps: `1. Requirements: functional first, then non-functional (scale, latency, availability, consistency). The candidate asks; the interviewer answers with concrete numbers.
2. Back-of-the-envelope estimates: requests per second, storage, bandwidth, with the arithmetic done slowly in words.
3. API design: the main endpoints and what they take and return, in words.
4. Data model and storage choice, and why this database over the alternatives.
5. High-level design: walk one request through every component.
6. Deep dives: the two or three hardest parts of this particular problem, prompted by the interviewer's follow-up questions.
7. Bottlenecks, failure modes and trade-offs, and what changes at ten times the scale.
8. Wrap-up: a thirty-second summary of the design.`,
  },
  lld: {
    who: 'a low-level design (machine coding / object-oriented design) interview for a C# and .NET role',
    steps: `1. Requirements and use cases: what the system must do, what is out of scope. The candidate asks; the interviewer answers.
2. Core entities: the nouns that become classes, enums and interfaces.
3. Relationships and responsibilities: a class diagram described in words (who owns whom, who depends on which interface).
4. Design patterns: which ones fit, why, and where exactly they sit (for example Strategy for pricing rules, State for the lift's movement, Observer for notifications, Factory for creating vehicles).
5. Key flows: walk through the two or three main use cases method by method, in words.
6. Concurrency and edge cases: double booking, race conditions, locking, invalid states.
7. Extensibility: how a new requirement lands without rewriting classes, tied back to SOLID.
8. Wrap-up: a thirty-second summary of the design.`,
  },
} as const

function interviewPrompt(cat: ExplainerCategory, kind: keyof typeof INTERVIEW_TEMPLATES, topic: Topic | null, covered: string[]): string {
  const t = INTERVIEW_TEMPLATES[kind]
  const choose = topic
    ? `Today's problem: ${topic.title}${topic.details ? `\nWhat I want from it: ${topic.details}` : ''}`
    : `Choose today's problem yourself: a well-known ${kind === 'lld' ? 'low-level design' : 'system design'} interview problem that is NOT already covered. Already covered:
${covered.slice(-200).map((c) => `- ${c}`).join('\n') || '- (nothing yet)'}`
  return `You write a daily audio series of mock interviews for My Daily Clippings. Each episode is a realistic script of ${t.who}, for two voices. The listener is a senior software engineer preparing for interviews at top product companies. They play the interviewer in their head and learn, by hearing it done well every day, one repeatable way to structure an answer.

${choose}

The two speakers:
- Interviewer: a senior engineer at a top product company. Speaks briefly. Sets the problem, answers clarifying questions with concrete numbers, pushes back, and asks realistic follow-ups ("what happens when this node dies?", "why not just use X?", "how does this behave at ten times the load?").
- Candidate: a strong senior engineer who drives the conversation, thinks out loud and explains every decision with its trade-off in plain words.

The candidate follows the same template every time and says the name of each step out loud when moving to it, so the listener learns the template:
${t.steps}

Whenever the candidate uses a known pattern, technique or principle, they name it explicitly and explain it in one sentence (for example "this is the cache-aside pattern", "that's consistent hashing", "I'd use an idempotency key here", "this is the Strategy pattern"). Naming patterns quickly under pressure is the skill being trained.

After the interview, add a final section "## Interviewer's notes", spoken by the Interviewer: what made this answer strong, the three to five key terms and patterns to remember from this problem, and one common mistake candidates make.

Format rules:
- Every spoken paragraph starts with "**Interviewer:**" or "**Candidate:**". Nothing else is spoken: no narrator and no stage directions.
- Put a ## heading before each template step; the headings are chapter markers on the website and are not read aloud.
- Keep turns natural. The interviewer's turns are short; the candidate's can run to a paragraph when explaining.
- About 2,000 to 2,600 words in total (15 to 18 minutes spoken).
- Describe diagrams, schemas, class structures and APIs in words.
- Be accurate about numbers and real systems, and say when something is an assumption.
${STYLE_RULES}

On the very first line, write "TOPIC:" followed by a short title for the problem (under 80 characters, for example "Design a URL Shortener"), then a blank line, then the script.`
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

// When the model forgets the TOPIC line on a topic it chose itself, ask for a title
// rather than saving a generic one (which also keeps the covered list useful).
async function titleFor(draft: string): Promise<string> {
  try {
    const { text } = await generate(
      `Give a short, specific title (under 80 characters) for this audio episode. Reply with the title only.\n\n${draft.slice(0, 4000)}`,
      GEMINI_API_KEY!,
      { temperature: 0.2, role: 'explainer' },
    )
    return stripFences(text).split('\n')[0].replace(/^[\s*_#>"']*(title\s*:)?\s*/i, '').replace(/[*_"]+/g, '').trim().slice(0, 100)
  } catch (err) {
    console.warn(`  ⚠ Title request failed: ${describeError(err)}`)
    return ''
  }
}

async function writeEpisode(cat: ExplainerCategory, topic: Topic | null, covered: string[], slug: string) {
  let title: string
  let text: string
  const interviewKind = cat.dialogue ?? (topic?.dialogue ? 'lld' : undefined)
  if (cat.format === 'short') {
    if (!topic) throw new Error('short format needs a topic')
    const { text: raw } = await generate(shortPrompt(topic), GEMINI_API_KEY!, { temperature: 0.4, role: 'explainer' })
    title = topic.title
    text = await editorPass(stripFences(raw), `Question: ${topic.title}`, 'question')
  } else {
    const prompt = interviewKind
      ? interviewPrompt(cat, interviewKind, topic, covered)
      : longPrompt(cat, topic, covered)
    const { text: raw } = await generate(prompt, GEMINI_API_KEY!, { temperature: 0.5, role: 'explainer' })
    const lines = stripFences(raw).split('\n')
    // Tolerate "**TOPIC:** ...", "# Topic: ..." and similar decorations.
    const topicIdx = lines.findIndex((l) => /^[\s*_#>]*TOPIC\s*:/i.test(l))
    const draft = lines.filter((_, i) => i !== topicIdx).join('\n').trim()
    const words = draft.split(/\s+/).length
    if (words < 600) throw new Error(`Explainer too short (${words} words)`)
    if (interviewKind && !/\*\*(Interviewer|Candidate):\*\*/.test(draft)) throw new Error('Interview script has no speaker lines')
    title =
      (topicIdx >= 0 ? lines[topicIdx].replace(/^[\s*_#>]*TOPIC\s*:\s*/i, '').replace(/[*_]+/g, '').trim() : '') ||
      topic?.title ||
      (await titleFor(draft)) ||
      `${cat.label} explainer`
    // Interviews are not edited: the editor pass would smooth away the speaker turns.
    text = interviewKind ? draft : await editorPass(draft, `Topic: ${title}`, 'explainer')
  }

  writePage(
    cat.slug,
    slug,
    {
      title:
        cat.format === 'short'
          ? title
          : `${interviewKind && !cat.dialogue ? (cat.interviewTitlePrefix ?? `${cat.label} Interview`) : (cat.titlePrefix ?? `${cat.label} Explained`)}: ${title}`,
      date: today,
      category: cat.slug,
      topic: title,
      ...(interviewKind ? { format: 'dialogue', speakers: ['Interviewer', 'Candidate'] } : {}),
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
  if (topic?.vaultNote && topic.vaultLine !== undefined) {
    vault.markDone(topic.vaultNote, topic.vaultLine, topic.title, `${SITE_URL}/${cat.slug}/${slug}/`, today)
  }
  if (topic?.issue) answeredIssues.push(`${topic.issue} ${SITE_URL}/${cat.slug}/${slug}/`)
}

async function generateSeries(cat: ExplainerCategory, issues: Issue[], used: Set<number>) {
  console.log(`\n[${cat.slug}] ${cat.format === 'short' ? 'Questions' : 'Explainer'}...`)
  const covered = coveredTopics(cat.slug)
  const fromIssues = issuesFor(cat, issues, used).slice(0, cat.perDay)
  const fromVault: Topic[] = vault.vaultEnabled()
    ? vault.openTopics(cat.vaultNote).map((v) => ({
        title: v.title,
        details: v.details,
        vaultNote: v.vaultNote,
        vaultLine: v.vaultLine,
        dialogue: v.dialogue,
      }))
    : []

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
    } else if (fromVault.length) {
      topic = fromVault.shift()!
      console.log(`[${cat.slug}] From the vault (${topic.vaultNote}): ${topic.title}`)
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

type SeenMap = Record<string, string[]> // issue number (or "vault:<topic>") -> links already considered

// A watched topic, from an open "watch" issue or a line in the vault's Podcast/Watchlist.md.
interface WatchTopic {
  key: string
  title: string
  focus: string
}

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
  const watches: WatchTopic[] = [
    ...issues
      .filter((i) => hasLabel(i, WATCH_LABEL))
      .map((i) => ({ key: String(i.number), title: i.title.trim(), focus: (i.body ?? '').trim().slice(0, 500) })),
    ...(vault.vaultEnabled() ? vault.watches() : []),
  ].filter((w, idx, all) => all.findIndex((o) => o.title.toLowerCase() === w.title.toLowerCase()) === idx)
  if (watches.length === 0) {
    console.log('[watchlist] Nothing on the watchlist')
    return
  }
  const outputPath = path.join(NEWSLETTERS_DIR, WATCH_DIR, `${today}.md`)
  if (fs.existsSync(outputPath) && !FORCE) {
    console.log('[watchlist] Already exists, skipping.')
    return
  }

  const seen = loadSeen()
  const found: { watch: WatchTopic; articles: Article[] }[] = []
  for (const watch of watches) {
    const articles = await fetchArticles([{ name: 'Google News', url: googleNewsFeed(watch.title) }])
    const already = new Set(seen[watch.key] ?? [])
    const fresh = articles.filter((a) => !already.has(a.url))
    console.log(`[watchlist] ${watch.key} "${watch.title}": ${fresh.length} new of ${articles.length}`)
    if (fresh.length) found.push({ watch, articles: fresh })
  }
  if (found.length === 0) {
    console.log('[watchlist] Nothing new today, no episode.')
    return
  }

  let n = 0
  const numbered: Article[] = []
  const blocks = found.map(({ watch, articles }) => {
    const focus = watch.focus
    const lines = articles.map((a) => {
      numbered.push(a)
      n++
      return `[${n}] (${a.source}, ${a.publishedAt.toISOString().slice(0, 10)}) ${a.title}${a.summary ? `\n    ${a.summary}` : ''}`
    })
    return `### Watched topic: ${watch.title}${focus ? `\nWhat I care about: ${focus}` : ''}\n${lines.join('\n')}`
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
  for (const { watch, articles } of found) {
    const key = watch.key
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
  const topics = found.map((f) => f.watch.title)
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

// ---------- headlines (one short briefing over everything made today, plus the sky) ----------
// Runs last. The morning run makes it only when every news category exists and
// nothing failed; otherwise the afternoon catch-up run makes it with whatever exists,
// so the briefing is never built from half a day.

const HEADLINES_DIR = 'headlines'
const WORDS_PER_MINUTE = 150 // roughly the TTS voice's pace

interface TodayPage {
  dir: string
  slug: string
  meta: Record<string, any>
  body: string
}

function todaysPages(dir: string): TodayPage[] {
  const folder = path.join(NEWSLETTERS_DIR, dir)
  if (!fs.existsSync(folder)) return []
  return fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.md') && f.startsWith(today))
    .sort()
    .map((f) => {
      const raw = fs.readFileSync(path.join(folder, f), 'utf-8')
      const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
      return {
        dir,
        slug: f.replace(/\.md$/, ''),
        meta: m ? ((yaml.load(m[1]) as Record<string, any>) ?? {}) : {},
        body: m ? m[2] : raw,
      }
    })
}

function minutesOf(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).length / WORDS_PER_MINUTE))
}

function headingsOf(body: string): string[] {
  return [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].replace(/\*+/g, '').trim())
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const m = flat.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : flat).trim()
}

async function generateHeadlines() {
  console.log('\n[headlines] Daily briefing...')
  const outputPath = path.join(NEWSLETTERS_DIR, HEADLINES_DIR, `${today}.md`)
  if (fs.existsSync(outputPath) && !FORCE) {
    console.log('[headlines] Already exists, skipping.')
    return
  }

  const news = NEWS_CATEGORIES.map((c) => ({ cat: c, page: todaysPages(c.slug)[0] }))
  const missing = news.filter((n) => !n.page).map((n) => n.cat.slug)
  const istHour = ist.getUTCHours()
  if ((missing.length || failures.length) && istHour < 12) {
    console.log(`[headlines] Waiting for the catch-up run (missing: ${missing.join(', ') || 'none'}; failures: ${failures.length})`)
    return
  }
  const present = news.filter((n) => n.page) as { cat: NewsCategory; page: TodayPage }[]
  if (present.length === 0) {
    console.log('[headlines] No news pages today, skipping.')
    return
  }

  // What was made today, as compact material for the briefing.
  const newsMaterial = present
    .map(({ cat, page }) => {
      const tops = (page.meta.topStories ?? []).map((t: any) => `  - ${t.headline}`).join('\n')
      return `### ${cat.label}\nSummary: ${String(page.meta.summary ?? '').replace(/\s+/g, ' ')}\nSections: ${headingsOf(page.body).join(' | ')}\nTop stories:\n${tops}\nOpening paragraph: ${extractSummary(page.body)}`
    })
    .join('\n\n')
  const explainers = EXPLAINER_CATEGORIES.filter((c) => c.format === 'long').flatMap((c) =>
    todaysPages(c.slug).map((p) => ({ label: c.label, topic: String(p.meta.topic ?? p.meta.title), minutes: minutesOf(p.body) })),
  )
  const questions = EXPLAINER_CATEGORIES.filter((c) => c.format === 'short').flatMap((c) =>
    todaysPages(c.slug).map((p) => ({ topic: String(p.meta.question ?? p.meta.topic ?? p.meta.title), minutes: minutesOf(p.body) })),
  )
  const watch = todaysPages('watchlist')[0]
  const sky = skyReport(today)

  const extras = [
    explainers.length
      ? `Today's explainers:\n${explainers.map((e) => `- ${e.label}: ${e.topic} (about ${e.minutes} minutes)`).join('\n')}`
      : '',
    questions.length ? `Curious questions answered today:\n${questions.map((q) => `- ${q.topic} (about ${q.minutes} minutes)`).join('\n')}` : '',
    watch ? `Watchlist has an update today on: ${(watch.meta.topics ?? []).join(', ')}. Summary: ${watch.meta.summary ?? ''}` : '',
    sky.highlights.length ? `Sky highlights today (mention in one short sentence after the opening; details are read at the end): ${sky.highlights.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = `You write "Headlines", the short spoken briefing that opens the listener's day for My Daily Clippings. It is played first on the morning commute, and helps the listener decide which full episodes to play next.

Today is ${today}. Below is everything published today.

${newsMaterial}

${extras}

Write the script:
- About 400 to 550 words (3 to 4 minutes spoken). Tight, warm, radio-style; no filler.
- Open with one sentence greeting the listener with the day and date.
- Then one ## section per news category, in order of how significant today's news is (most important first). In each, cover the single most important story in one or two sentences, and name a second story in a short clause if it is notable. Use only facts in the material above; never add details.
- Then a ## section called "Also today" that lists the explainers by topic with their approximate length, then any curious questions and the watchlist update, in one or two natural sentences each. Skip anything not present.
- Do not end with a sign-off; another section follows.
${STYLE_RULES}`

  let text: string
  let summary: string
  try {
    const { text: raw } = await generate(prompt, GEMINI_API_KEY!, { temperature: 0.3, role: 'headlines' })
    text = stripFences(raw)
    if (text.split(/\s+/).length < 150) throw new Error('briefing too short')
    summary = extractSummary(text)
  } catch (err) {
    // Out of quota or a bad response: build a plain briefing from the summaries instead.
    console.warn(`[headlines] Gemini failed, using the plain version: ${describeError(err)}`)
    const sections = present.map(({ cat, page }) => {
      const top = (page.meta.topStories ?? [])[0]?.headline as string | undefined
      const heads = headingsOf(page.body).slice(0, 3)
      const lines = [
        top ? `Top story: ${top.replace(/[.!?]?$/, '.')}` : '',
        heads.length ? `Also in today's episode: ${heads.join('; ')}.` : firstSentence(extractSummary(page.body)),
      ]
      return `## ${cat.label}\n\n${lines.filter(Boolean).join(' ')}`
    })
    const also = [
      explainers.length ? `Today's explainers: ${explainers.map((e) => `${e.label}, ${e.topic}, about ${e.minutes} minutes`).join('. ')}.` : '',
      questions.length ? `Curious questions: ${questions.map((q) => q.topic).join('. ')}.` : '',
      watch ? `Watchlist has an update on ${(watch.meta.topics ?? []).join(', ')}.` : '',
    ].filter(Boolean)
    const d = new Date(`${today}T00:00:00Z`)
    const spoken = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
    text = [`Good morning. Here are your headlines for ${spoken}.`, ...sections, also.length ? `## Also today\n\n${also.join(' ')}` : '']
      .filter(Boolean)
      .join('\n\n')
    summary = `Headlines for ${spoken}: ${present.map((p) => p.cat.label).join(', ')}.`
  }

  text = `${text.trim()}\n\n${sky.markdown.trim()}\n\nThat's it for the headlines. Enjoy the ride.`
  writePage(
    HEADLINES_DIR,
    today,
    {
      title: `Headlines — ${today}`,
      date: today,
      category: HEADLINES_DIR,
      summary: summary.substring(0, 220),
      skyHighlights: sky.highlights,
      topStories: present.flatMap(({ page }) => (page.meta.topStories ?? []).slice(0, 1)),
      sources: [],
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
  if (vault.vaultEnabled()) {
    try {
      const moved = vault.ingestInbox(EXPLAINER_CATEGORIES.map((c) => c.vaultNote).concat(vault.WATCHLIST_NOTE))
      console.log(`\n[vault] Obsidian vault found; ${moved} podcast item(s) moved from the Inbox`)
    } catch (err) {
      failures.push(`vault inbox: ${describeError(err)}`)
    }
  } else {
    console.log('\n[vault] No Obsidian vault checked out (OBSIDIAN_TOKEN not set?); using issues and topics/ only')
  }
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
  if (ONLY.has('headlines')) await withRetry('headlines', generateHeadlines)

  fs.writeFileSync(path.join(ROOT, '.generation-failures.txt'), failures.join('\n'), 'utf-8')
  fs.writeFileSync(path.join(ROOT, '.answered-issues.txt'), answeredIssues.join('\n'), 'utf-8')
  console.log(`\nDone. ${failures.length} failure(s).`)
  if (failures.length) console.log(failures.map((f) => `  ✗ ${f}`).join('\n'))
}

main()
