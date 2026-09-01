# Grayhaven Nerve documentation

The docs site for [Grayhaven Nerve](https://github.com/tylergibbs1/nerve),
built with [Fumadocs](https://fumadocs.dev) on Next.js.

This is a standalone project with its own lockfile. It is deliberately not a
workspace member: the monorepo's install, audit, typecheck, and build gates
cover the published packages, and a Next.js app does not belong in that set.

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
```

```bash
bun run build        # production build
bun run typecheck
bun run lint:links   # broken internal links and anchors
```

## Layout

```text
content/docs/          authored MDX, one folder per navbar tab
  (index)/             quickstart, concepts, guides, troubleshooting
  reference/           CLI, DSL, SDK, HIR, artifacts, parts, rules
  changelog/
content/generated/     generated fragments — do not edit
src/                   the Next.js app
assets/                demo recordings the repository README embeds
```

## Generated reference

The DSL prop tables, the HIR schema, the rule list, the part library, and the
changelog are extracted from `@grayhaven/*` source, so they cannot drift from
the code. They live in `content/generated/` and are pulled into authored pages
with `<include>`.

Regenerate from the repository root:

```bash
bun run docs:reference
```

The root `bun run build` runs it, and CI fails when the committed fragments do
not match a fresh generation. `tests/generated-docs.test.ts` guards the DSL
extraction specifically.

To document something new, write the prose in MDX and pull in the table. Never
edit a file under `content/generated/`.

## Deploy

Deployed as its own Vercel project with the root directory set to `docs`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | Canonical origin. Drives metadata, sitemap, robots, RSS, and the source links in `llms.txt`. |

The workspace app at `nerve.grayhavenindustries.com` links here, and the root
`vercel.json` permanently redirects the old in-app `/docs/*` URLs to their new
homes. If the docs domain changes, update `vercel.json`,
`packages/nerve-web/src/lib/site.ts`, and this project's
`NEXT_PUBLIC_BASE_URL` together.
