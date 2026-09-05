# @grayhaven/nerve-interop

## 8.1.0

### Patch Changes

- ec7b19c: Ship a CommonJS build alongside the ESM one and declare a `require` export condition. Through 8.0.0 none of these packages could be loaded from CommonJS, in one of two ways. Nine of them published an `import`-only exports map, so `require("@grayhaven/nerve")` failed with a misleading `No "exports" main defined`. `@grayhaven/nerve-react` published a `default` map with no root `main` or `types`, so the condition matched but resolved to an ESM file: `ERR_REQUIRE_ESM` on Node below 22.12, and a silent require(esm) on newer runtimes. Types now resolve per condition (`index.d.ts` for `import`, `index.d.cts` for `require`), and the pack-and-install smoke test exercises both entry paths. `@grayhaven/nerve-cli` and `@grayhaven/nerve-compiler` stay ESM-only: they read `import.meta`, which has no correct CommonJS equivalent.
- Updated dependencies [ec7b19c]
- Updated dependencies [b7291e3]
  - @grayhaven/nerve@8.1.0

## 8.0.0

### Major Changes

- 00c77ea: Add deterministic product-family configuration and supply snapshots, approved
  electrical test specifications with generic tester evidence, headless
  event-sourced unit-build execution, and the initial standards, VEC 2.2, OPC UA
  40570, automation, and high-voltage interoperability package. Shop-floor
  closure and reservation gates, numeric process facts, and external interchange
  DTOs fail closed when their authority or structure is incomplete.

  This is a major release because build-record schema `0.2.0` adds authorized
  test specifications and unassessed verdicts, the Cirris adapter is no longer a
  default built-in, hard-coded tester thresholds are removed in favor of limits
  authorized by an approved test specification, and `nerve record` now exits 2
  for incomplete build records, including unassessed evidence. The historical
  `TestVerdict` result-object name remains available; use `TestVerdictStatus` for
  the scalar verdict value.

### Patch Changes

- Updated dependencies [00c77ea]
  - @grayhaven/nerve@8.0.0
