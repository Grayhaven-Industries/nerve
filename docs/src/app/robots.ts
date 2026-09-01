import type { MetadataRoute } from 'next'
import { url } from '@/lib/url'

export const revalidate = false

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: url('/sitemap.xml'),
    host: url('/'),
  }
}
