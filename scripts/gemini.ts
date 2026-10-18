import { GoogleGenAI } from '@google/genai'

export interface GeminiResult {
  text: string
  sourceUrls: string[]
}

export interface GenerateOptions {
  search?: boolean // enable Google Search grounding
  temperature?: number
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
// Free tier allows only a few requests per minute; space every call out.
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 15000)
const MAX_ATTEMPTS = 3

let lastCall = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
  return fn()
}

function isRetryable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err)
  return /429|RESOURCE_EXHAUSTED|500|502|503|504|UNAVAILABLE|overloaded|deadline|fetch failed|ECONNRESET/i.test(msg)
}

export async function generate(prompt: string, apiKey: string, opts: GenerateOptions = {}): Promise<GeminiResult> {
  const client = new GoogleGenAI({ apiKey })
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await paced(() =>
        client.models.generateContent({
          model: MODEL,
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
      if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
        const backoff = 65000 * attempt
        console.warn(`  ⚠ Gemini attempt ${attempt} failed (${String(err).slice(0, 160)}); retrying in ${backoff / 1000}s`)
        await sleep(backoff)
        continue
      }
      throw err
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
): Promise<GeminiResult> {
  return generate(`${systemPrompt}\n\n---\n\n${userPrompt}`, apiKey, { search: true, temperature })
}
