import fs from 'fs'
import path from 'path'
import * as yaml from 'js-yaml'
import { generate, generateWithSearch } from './gemini'
import {
  EXPLAINER_CATEGORIES,
  NEWS_CATEGORIES,
  NEWS_SELECTION_RULES,
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
const ONLY = new Set((process.env.ONLY || 'news,explainers,questions').split(',').map((s) => s.trim()))
const MAX_QUESTIONS_PER_RUN = Number(process.env.MAX_QUESTIONS_PER_RUN ?? 5)

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
    const { text } = await generate(prompt, GEMINI_API_KEY!, { temperature: 0.2 })
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
      console.error(`[${label}] attempt ${attempt} failed:`, err)
      if (attempt === 2) failures.push(`${label}: ${String((err as Error)?.message ?? err).slice(0, 300)}`)
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

// ---------- explainers ----------

// Topics already covered in this series, from the explainer pages' frontmatter.
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
function nextQueuedTopic(slug: string, covered: string[]): { topic: string; line: string } | null {
  const file = path.join(TOPICS_DIR, `${slug}.md`)
  if (!fs.existsSync(file)) return null
  const seen = new Set(covered.map((t) => t.toLowerCase()))
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const topic = line.replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/, '').trim()
    if (!topic || line.trim().startsWith('#')) continue
    if (seen.has(topic.toLowerCase())) continue
    return { topic, line }
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

function explainerPrompt(cat: ExplainerCategory, topic: string | null, covered: string[]): string {
  const choose = topic
    ? `Today's topic: ${topic}`
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

async function generateExplainer(cat: ExplainerCategory) {
  console.log(`\n[${cat.slug}] Explainer...`)
  const outputPath = path.join(NEWSLETTERS_DIR, cat.slug, `${today}.md`)
  if (fs.existsSync(outputPath) && !FORCE) {
    console.log(`[${cat.slug}] Already exists, skipping.`)
    return
  }
  const covered = coveredTopics(cat.slug)
  const queued = nextQueuedTopic(cat.slug, covered)
  console.log(`[${cat.slug}] ${queued ? `Queued topic: ${queued.topic}` : 'Queue empty, model picks a topic'}`)

  const { text: raw } = await generate(explainerPrompt(cat, queued?.topic ?? null, covered), GEMINI_API_KEY!, {
    temperature: 0.5,
  })
  const lines = stripFences(raw).split('\n')
  const topicIdx = lines.findIndex((l) => /^\s*TOPIC:/i.test(l))
  const topic =
    (topicIdx >= 0 ? lines[topicIdx].replace(/^\s*TOPIC:\s*/i, '').replace(/\*+/g, '').trim() : '') ||
    queued?.topic ||
    `${cat.label} explainer`
  const draft = lines.filter((_, i) => i !== topicIdx).join('\n').trim()
  if (draft.split(/\s+/).length < 600) throw new Error(`Explainer too short (${draft.split(/\s+/).length} words)`)

  const text = await editorPass(draft, `Topic: ${topic}`, 'explainer')
  writePage(
    cat.slug,
    today,
    {
      title: `${cat.label} Explained: ${topic}`,
      date: today,
      category: cat.slug,
      topic,
      summary: extractSummary(text),
      topStories: [],
      sources: [],
    },
    text,
  )
  if (queued) removeQueuedLine(cat.slug, queued.line)
}

// ---------- curious questions (GitHub issues labelled "question") ----------

interface Issue {
  number: number
  title: string
  body: string | null
  html_url: string
  user: { login: string }
  pull_request?: unknown
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function openQuestions(): Promise<Issue[]> {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  if (!repo || !token) {
    console.log('[questions] GITHUB_REPOSITORY/GITHUB_TOKEN not set, skipping')
    return []
  }
  const owner = repo.split('/')[0].toLowerCase()
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=question&per_page=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub issues API: HTTP ${res.status}`)
  const issues = (await res.json()) as Issue[]
  // Only the repo owner's own questions: anyone can open issues on a public repo.
  return issues.filter((i) => !i.pull_request && i.user.login.toLowerCase() === owner)
}

async function answerQuestion(issue: Issue) {
  const question = issue.title.trim()
  const details = (issue.body ?? '').trim().slice(0, 1500)
  const prompt = `You answer curious questions for a personal audio series called "Curious Questions". The listener is a software engineer who loves understanding things from first principles.

Question: ${question}
${details ? `Extra context from the listener: ${details}\n` : ''}
Write a clear, accurate answer of about 500 to 900 words (3 to 6 minutes spoken).
- Start with the short answer in one or two sentences, then explain why, building up from basics.
- Use one everyday analogy or example. Mention a common misconception if there is one.
- Use 2 to 4 sections with ## headings.
- If the question has no settled answer, say what is known and what is debated.
${STYLE_RULES}`
  const { text: raw } = await generate(prompt, GEMINI_API_KEY!, { temperature: 0.4 })
  const text = await editorPass(stripFences(raw), `Question: ${question}`, 'question')
  const slug = `${today}-${slugify(question) || `q${issue.number}`}`
  writePage(
    'questions',
    slug,
    {
      title: question,
      date: today,
      category: 'questions',
      question,
      issue: issue.number,
      summary: extractSummary(text),
      topStories: [],
      sources: [],
    },
    text,
  )
  const siteUrl = 'https://aamukthaaukunooru.github.io/MyDailyClippings'
  answeredIssues.push(`${issue.number} ${siteUrl}/questions/${slug}/`)
}

// ---------- main ----------

async function main() {
  console.log(`\n✂ My Daily Clippings — generating for ${today}`)

  if (ONLY.has('news')) {
    for (const category of NEWS_CATEGORIES) await withRetry(category.slug, () => generateNews(category))
  }
  if (ONLY.has('explainers')) {
    for (const cat of EXPLAINER_CATEGORIES) await withRetry(cat.slug, () => generateExplainer(cat))
  }
  if (ONLY.has('questions')) {
    const questions = (await withRetry('questions', openQuestions)) ?? []
    console.log(`\n[questions] ${questions.length} open question(s)`)
    for (const issue of questions.slice(0, MAX_QUESTIONS_PER_RUN)) {
      await withRetry(`question #${issue.number}`, () => answerQuestion(issue))
    }
  }

  fs.writeFileSync(path.join(ROOT, '.generation-failures.txt'), failures.join('\n'), 'utf-8')
  fs.writeFileSync(path.join(ROOT, '.answered-issues.txt'), answeredIssues.join('\n'), 'utf-8')
  console.log(`\nDone. ${failures.length} failure(s).`)
  if (failures.length) console.log(failures.map((f) => `  ✗ ${f}`).join('\n'))
}

main()
