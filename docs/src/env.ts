import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

/**
 * The canonical origin, in order of preference:
 *   NEXT_PUBLIC_BASE_URL              — set it on the production deployment
 *   VERCEL_PROJECT_PRODUCTION_URL     — Vercel supplies this automatically
 *   http://localhost:3000             — local development
 *
 * It drives metadata, the sitemap, robots, RSS, and the Source links in
 * llms.txt, so a wrong value is visible everywhere. The Vercel fallback keeps
 * a preview deployment honest without hand-configuring each one.
 */
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.url(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_BASE_URL:
      process.env.NEXT_PUBLIC_BASE_URL ??
      (vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000'),
  },
})
