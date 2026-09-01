---
"@grayhaven/nerve": patch
"@grayhaven/nerve-connectors": patch
"@grayhaven/nerve-eval": patch
"@grayhaven/nerve-exporters": patch
"@grayhaven/nerve-importers": patch
"@grayhaven/nerve-interop": patch
"@grayhaven/nerve-platform": patch
"@grayhaven/nerve-react": patch
"@grayhaven/nerve-rules": patch
"@grayhaven/nerve-wireviz": patch
---

Ship a CommonJS build alongside the ESM one and declare a `require` export condition. Through 8.0.0 none of these packages could be loaded from CommonJS, in one of two ways. Nine of them published an `import`-only exports map, so `require("@grayhaven/nerve")` failed with a misleading `No "exports" main defined`. `@grayhaven/nerve-react` published a `default` map with no root `main` or `types`, so the condition matched but resolved to an ESM file: `ERR_REQUIRE_ESM` on Node below 22.12, and a silent require(esm) on newer runtimes. Types now resolve per condition (`index.d.ts` for `import`, `index.d.cts` for `require`), and the pack-and-install smoke test exercises both entry paths. `@grayhaven/nerve-cli` and `@grayhaven/nerve-compiler` stay ESM-only: they read `import.meta`, which has no correct CommonJS equivalent.
