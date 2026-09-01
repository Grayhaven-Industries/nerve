# Releasing

All twelve publishable `@grayhaven/*` packages version in lockstep via
[changesets](https://github.com/changesets/changesets) (fixed group
`@grayhaven/*` in `.changeset/config.json`; private packages such as
`@grayhaven/nerve-web` are excluded from versioning).

## Flow

1. **Changeset per change** — with your change, run `bun run changeset`
   and describe it. This writes a markdown file into `.changeset/`;
   commit it with the change.
2. **Version** — when ready to release, run `bun run version-packages`.
   This consumes pending changesets, bumps every package in the fixed
   group to the same new version, writes changelog entries, re-runs
   `bun install`, and explicitly synchronizes the workspace version fields
   in `bun.lock`. Bun does not update or validate those fields for a
   version-only manifest change, even with `--frozen-lockfile`; do not omit
   the sync step. `bun run check-workspace-lock` verifies them without
   modifying the lockfile.
3. **Commit** the version bump.
4. **Tag** `vX.Y.Z` (must match `packages/nerve/package.json`):
   `git tag vX.Y.Z`
5. **Push the tag** — `git push origin vX.Y.Z`. This triggers
   `.github/workflows/release.yml`, which typechecks, tests, builds,
   smoke-tests the tarballs, and publishes every package in dependency
   order via `scripts/publish-all.ts`.

## Partial publish recovery

`publish-all.ts` is idempotent: before each publish it asks the registry
whether that exact `name@version` already exists and skips it if so. If a
release fails partway (package 6 of 12 errors), just re-run the workflow
(or `bun scripts/publish-all.ts` from CI) — the already-published prefix
is skipped automatically and publishing resumes where it stopped. No
hand-editing of the package list is needed anymore. Only a positive
registry confirmation skips; on a network error the publish is attempted
anyway and fails loudly if there is a real conflict.

## Changelogs

CHANGELOG.md entries now come from changesets: `changeset version`
generates them from the pending `.changeset/*.md` files. Do not
hand-write changelog entries for released changes — write a changeset
instead.
