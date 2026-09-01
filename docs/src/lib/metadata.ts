import type { Metadata } from 'next'
import { env } from '@/env'
import { description, title } from '@/lib/layout.shared'
import type { Page } from './source'

export function createMetadata(override: Metadata): Metadata {
  return {
    ...override,
    openGraph: {
      title: override.title ?? undefined,
      description: override.description ?? undefined,
      url: env.NEXT_PUBLIC_BASE_URL,
      siteName: title,
      type: 'website',
      ...override.openGraph,
    },
    twitter: {
      card: 'summary_large_image',
      title: override.title ?? undefined,
      description: override.description ?? undefined,
      ...override.twitter,
    },
    description: override.description ?? description,
  }
}

export function getPageImage(page: Page) {
  const segments = [...page.slugs, 'image.webp']
  return {
    segments,
    url: `/og/${segments.join('/')}`,
  }
}

export const baseUrl =
  env.NODE_ENV === 'development' || !env.NEXT_PUBLIC_BASE_URL
    ? new URL('http://localhost:3000')
    : new URL(env.NEXT_PUBLIC_BASE_URL)
