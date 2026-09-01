import { description, title } from '@/lib/layout.shared'
import { baseUrl, createMetadata } from '@/lib/metadata'
import '@/styles/globals.css'
import type { Viewport } from 'next'
import { Chakra_Petch, Geist, Geist_Mono } from 'next/font/google'
import { Body } from './layout.client'
import { Providers } from './providers'
import 'katex/dist/katex.css'
import { NextProvider } from 'fumadocs-core/framework/next'
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree'
import { source } from '@/lib/source'
import { url } from '@/lib/url'

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const mono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Chakra Petch 500 carries headings and the wordmark on every other
// Grayhaven surface; the docs share the wordmark, so they share the face.
const heading = Chakra_Petch({
  variable: '--font-chakra-petch',
  subsets: ['latin'],
  weight: ['500', '600'],
})

export const metadata = createMetadata({
  title: {
    template: '%s | Grayhaven Nerve',
    default: 'Grayhaven Nerve documentation',
  },
  description,
  metadataBase: baseUrl,
  alternates: {
    types: {
      'application/rss+xml': [
        {
          title,
          url: url('/rss.xml'),
        },
      ],
    },
  },
})

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#161513' },
    { media: '(prefers-color-scheme: light)', color: '#fff' },
  ],
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      className={`${geist.variable} ${mono.variable} ${heading.variable}`}
      lang='en'
      suppressHydrationWarning
    >
      <Body tree={source.getPageTree()}>
        <NextProvider>
          <TreeContextProvider tree={source.getPageTree()}>
            <Providers>{children}</Providers>
          </TreeContextProvider>
        </NextProvider>
      </Body>
    </html>
  )
}
