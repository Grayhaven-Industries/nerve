import { llms } from 'fumadocs-core/source'
import { description, title } from '@/lib/layout.shared'
import { source } from '@/lib/source'
import { url } from '@/lib/url'

export const revalidate = false

export function GET() {
  // fumadocs emits site-relative links. An agent that fetched this file from
  // somewhere else cannot resolve those, so absolutize them here.
  const index = llms(source)
    .index()
    .replace(/\]\(\//g, `](${url('/')}`)
    // The generated index leads with a generic "# Docs" heading; name the
    // product instead, and follow the llms.txt convention of a blockquote
    // summary directly under it.
    .replace(/^# .*\n/, '')

  return new Response(
    `# ${title}

> ${description} Nerve is a harness verification compiler: structured harness data in, versioned HIR, stable HK-* findings, and byte-reproducible manufacturing artifacts out.

${index.trimStart()}
Everything below embedded in one file: ${url('/llms-full.txt')}

## Source

- [GitHub repository](https://github.com/tylergibbs1/nerve): Apache-2.0 monorepo with golden-fixture examples
- [Browser workspace](https://nerve.grayhavenindustries.com/projects): compiles in the browser
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  )
}
