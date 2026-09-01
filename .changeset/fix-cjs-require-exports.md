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

Ship a CommonJS build alongside the ESM one and declare a `require` export condition. Through 8.0.0 these packages published an `import`-only exports map, so `require("@grayhaven/nerve")` failed with a misleading `No "exports" main defined` and any tool resolving with require conditions could not load them. Types now resolve per condition (`index.d.ts` for `import`, `index.d.cts` for `require`), and the pack-and-install smoke test exercises both entry paths. `@grayhaven/nerve-cli` and `@grayhaven/nerve-compiler` stay ESM-only: they read `import.meta`, which has no correct CommonJS equivalent.
