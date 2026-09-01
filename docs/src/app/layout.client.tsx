'use client'

import type { Root } from 'fumadocs-core/page-tree'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { findPage } from '@/lib/page-tree'

export function Body({ children, tree }: { children: ReactNode; tree: Root }) {
  const mode = useMode(tree)

  return (
    <body className={cn(mode, 'relative flex min-h-screen flex-col')}>
      {children}
    </body>
  )
}

export function useMode(tree: Root): string | undefined {
  const pathname = usePathname()
  const page = findPage(tree, pathname)

  // $ref is the page's file path; its first segment names the tab, which
  // is what carries the per-section accent colour in globals.css.
  const id = page?.$ref ?? ''
  return id.split('/')[0]
}
