/** Canonical deploy URL: one definition for gen-meta, OG tags, and config. */
export const SITE = "https://nerve.grayhavenindustries.com"

/**
 * The documentation site. Prose docs are a separate deployment (the `docs/`
 * Next.js app); this workspace links out to it rather than hosting them.
 * Keep in step with the docs project's NEXT_PUBLIC_BASE_URL.
 */
export const DOCS_SITE = "https://docs.grayhavenindustries.com"

/** A path on the docs site, e.g. docsUrl("/docs/reference/rules"). */
export const docsUrl = (path = ""): string => `${DOCS_SITE}${path}`
