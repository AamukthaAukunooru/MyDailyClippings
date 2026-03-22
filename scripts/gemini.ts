import { GoogleGenAI } from '@google/genai'

export interface GeminiResult {
  text: string
  sourceUrls: string[]
}

export async function generateWithSearch(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
): Promise<GeminiResult> {
  const client = new GoogleGenAI({ apiKey })

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.7,
    },
  })

  const candidate = response.candidates?.[0]
  if (!candidate) throw new Error('No candidates returned from Gemini')

  const text = candidate.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '')
    .join('') ?? ''

  // Extract source URLs from grounding metadata
  const chunks = candidate.groundingMetadata?.groundingChunks ?? []
  const sourceUrls: string[] = chunks
    .map((c: { web?: { uri?: string } }) => c.web?.uri)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .slice(0, 10) // cap at 10

  return { text, sourceUrls }
}
