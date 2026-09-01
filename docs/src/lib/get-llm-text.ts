import { categories } from '@/lib/constants'
import { owner, repo } from '@/lib/github'
import type { Page } from '@/lib/source'
import { url } from '@/lib/url'

export async function getLLMText(page: Page) {
  const slugs = page.path.split('/')
  const category = categories[slugs[0]] ?? slugs[0]

  const processed = await page.data.getText('processed')
  // The docs site is the `docs/` directory of the monorepo, so a raw source
  // link needs that prefix as well as the collection path.
  const path = `docs/content/docs/${page.path}`

  return `# ${category}: ${page.data.title}
URL: ${url(page.url)}
Source: https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/main/${path}

${page.data.description ?? ''}

${processed}`
}
