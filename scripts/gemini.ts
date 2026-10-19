import { GoogleGenAI } from '@google/genai'

export interface GeminiResult {
  text: string
  sourceUrls: string[]
}

// Which job a call does. Each role can use its own model (repo variables), so the
// work is spread across models: free-tier quotas are counted per model.
export type Role = 'news' | 'editor' | 'explainer' | 'watchlist'

export interface GenerateOptions {
  search?: boolean // enable Google Search grounding
  temperature?: number
  role?: Role
  fallback?: boolean // try other models when this one is out of daily quota (default true)
}

// Free tier for this project, from the AI Studio rate-limit page (Oct 2026):
//   gemini-2.5-flash       5 RPM, 250K TPM, 20 RPD
//   gemini-2.5-flash-lite  not available (limit 0)
//   Google Search grounding 1,500 RPD
// Daily quotas reset at midnight Pacific. A full day needs about 12 Flash calls
// plus 1 per curious question, so everything runs on Flash with no fallback, and
// the fact-check pass (an extra call per page) is off unless EDITOR_PASS=true.
// With billing enabled: set EDITOR_PASS=true and
// GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite (repo variables) to use more models.
const FLASH = 'gemini-2.5-flash'
const FLASH_LITE = 'gemini-2.5-flash-lite'

const ROLE_MODEL: Record<Role, string> = {
  news: process.env.GEMINI_MODEL || FLASH,
  editor: process.env.GEMINI_EDITOR_MODEL || FLASH_LITE,
  explainer: process.env.GEMINI_EXPLAINER_MODEL || process.env.GEMINI_MODEL || FLASH,
  watchlist: process.env.GEMINI_MODEL || FLASH,
}
// Tried in order when a role's model has used up its daily quota.
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

// Free tier allows only a few requests per minute; space every call out.
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 15000)
const MAX_ATTEMPTS = 3

let lastCall = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const exhausted = new Set<string>() // models whose daily quota is used up this run

export class QuotaExhaustedError extends Error {}

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
  return fn()
}

function messageOf(err: unknown): string {
  return String((err as { message?: string })?.message ?? err)
}

// A short, readable reason for the failure issue, e.g.
// "429 quota: generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash (per day)"
export function describeError(err: unknown): string {
  const msg = messageOf(err)
  if (err instanceof QuotaExhaustedError) return msg
  const metric = msg.match(/Quota exceeded for metric:\s*([^\n\\]+?)(?:\\n|\n|$)/i)?.[1]
  const quotaId = msg.match(/"quotaId":\s*"([^"]+)"/)?.[1]
  if (/429|RESOURCE_EXHAUSTED/.test(msg)) {
    return `429 quota${metric ? `: ${metric.trim()}` : ''}${quotaId ? ` [${quotaId}]` : ''}`.slice(0, 300)
  }
  return msg.replace(/\s+/g, ' ').slice(0, 300)
}

function isDailyQuota(err: unknown): boolean {
  const msg = messageOf(err)
  return /429|RESOURCE_EXHAUSTED/.test(msg) && /PerDay|per_day|per day|RequestsPerDay/i.test(msg)
}

function isRetryable(err: unknown): boolean {
  return /429|RESOURCE_EXHAUSTED|500|502|503|504|UNAVAILABLE|overloaded|deadline|fetch failed|ECONNRESET/i.test(
    messageOf(err),
  )
}

async function callModel(model: string, prompt: string, apiKey: string, opts: GenerateOptions): Promise<GeminiResult> {
  const client = new GoogleGenAI({ apiKey })
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await paced(() =>
        client.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            ...(opts.search ? { tools: [{ googleSearch: {} }] } : {}),
            temperature: opts.temperature ?? 0.5,
          },
        }),
      )

      const candidate = response.candidates?.[0]
      if (!candidate) throw new Error('No candidates returned from Gemini')

      const text = candidate.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
      if (!text.trim()) throw new Error(`Empty response from Gemini (finishReason: ${candidate.finishReason ?? 'unknown'})`)

      const chunks = candidate.groundingMetadata?.groundingChunks ?? []
      const sourceUrls: string[] = chunks
        .map((c: { web?: { uri?: string } }) => c.web?.uri)
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .slice(0, 10)

      return { text, sourceUrls }
    } catch (err) {
      lastError = err
      if (isDailyQuota(err)) {
        // Waiting won't help until the quota resets; stop using this model for the run.
        exhausted.add(model)
        console.warn(`  ⚠ ${model}: daily quota used up (${describeError(err)})`)
        throw err
      }
      if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
        const backoff = 65000 * attempt
        console.warn(`  ⚠ ${model} attempt ${attempt} failed (${describeError(err)}); retrying in ${backoff / 1000}s`)
        await sleep(backoff)
        continue
      }
      throw err
    }
  }
  throw lastError
}

export async function generate(prompt: string, apiKey: string, opts: GenerateOptions = {}): Promise<GeminiResult> {
  const preferred = ROLE_MODEL[opts.role ?? 'news']
  const candidates = opts.fallback === false ? [preferred] : [preferred, ...FALLBACKS]
  const chain = [...new Set(candidates)].filter((m) => !exhausted.has(m))
  if (chain.length === 0) {
    throw new QuotaExhaustedError(`All models out of daily quota (${[...exhausted].join(', ')}); skipped`)
  }
  let lastError: unknown
  for (const model of chain) {
    try {
      if (model !== preferred) console.log(`  ↪ using fallback model ${model}`)
      return await callModel(model, prompt, apiKey, opts)
    } catch (err) {
      lastError = err
      if (!isDailyQuota(err)) throw err // only a daily quota moves us to the next model
    }
  }
  throw lastError
}

// Kept for the existing call sites: system prompt + user prompt with search grounding.
export async function generateWithSearch(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  temperature = 0.3,
  role: Role = 'news',
): Promise<GeminiResult> {
  return generate(`${systemPrompt}\n\n---\n\n${userPrompt}`, apiKey, { search: true, temperature, role })
}
