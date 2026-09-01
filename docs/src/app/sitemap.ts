import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { url } from '@/lib/url'

export const revalidate = false

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const items = await Promise.all(
    source.getPages().map(async (page) => {
      const { lastModified } = await page.data.load()

      return {
        url: url(page.url),
        lastModified: lastModified ? new Date(lastModified) : undefined,
        changeFrequency: 'weekly',
        priority: 0.5,
      } as MetadataRoute.Sitemap[number]
    })
  )

  // source.getPages() already contains the docs index, so listing /docs here
  // too would emit it twice with two different priorities.
  const docsIndex = url('/docs')

  // `/` redirects to /docs, so it does not belong in the sitemap.
  return [
    ...items
      .filter((v) => v !== undefined)
      .map((item) =>
        item.url === docsIndex ? { ...item, priority: 1 } : item
      ),
  ]
}
