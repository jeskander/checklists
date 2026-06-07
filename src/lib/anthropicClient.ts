const API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-haiku-4-20250514'

export function hasAnthropicConfig(): boolean {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
  return Boolean(key?.trim())
}

export function getAnthropicApiKey(): string | undefined {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
  return key?.trim() || undefined
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string
}

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

export async function askClaude(
  system: string,
  messages: AnthropicMessage[],
  maxTokens = 512
): Promise<string> {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    throw new Error('Add VITE_ANTHROPIC_API_KEY to .env.local')
  }

  const model = (import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined)?.trim() || DEFAULT_MODEL

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  })

  const data = (await res.json()) as AnthropicResponse
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Anthropic API error (${res.status})`)
  }

  const text = data.content?.find((block) => block.type === 'text')?.text?.trim()
  if (!text) throw new Error('Empty response from Claude')
  return text
}

export function parseJsonFromClaude<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? raw).trim()
  return JSON.parse(candidate) as T
}
