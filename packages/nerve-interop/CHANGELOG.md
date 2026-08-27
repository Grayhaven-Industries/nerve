# @grayhaven/nerve-interop

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
