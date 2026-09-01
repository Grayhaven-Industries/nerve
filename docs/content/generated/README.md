# Generated reference fragments

Everything in this directory is written by `docs/scripts/generate-reference.ts`
from `@grayhaven/*` source and the repository changelog. Do not edit these
files; edit the source they are extracted from, then run:

```bash
bun run docs:reference
```

The root `bun run build` runs that script, and CI fails if the committed
fragments do not match a fresh generation.

Each fragment is included into an authored page with `<include>`, so the prose
around a table lives in MDX while the table itself cannot drift from the code.
