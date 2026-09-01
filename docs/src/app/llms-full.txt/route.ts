import { description, title } from '@/lib/layout.shared'
import { getLLMText } from '@/lib/get-llm-text'
import { source } from '@/lib/source'
import { url } from '@/lib/url'

export const revalidate = false

export async function GET() {
  const scanned = await Promise.all(source.getPages().map(getLLMText))

  return new Response(
    `# ${title}: complete documentation

> ${description} This file embeds every page; no further fetches are needed. Index: ${url('/llms.txt')}

${scanned.join('\n\n---\n\n')}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  )
}
