# @grayhaven/nerve-platform

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
  - @grayhaven/nerve-importers@8.0.0

## 7.1.0

### Minor Changes

- 0c724c5: Add the platform package for reviewable harness releases.

  The compiler decides what a harness is. This package decides whether a
  submission may be released: who may act, what exactly was submitted, what the
  review found, how each finding was dispositioned, and whether the gate,
  the approvals, and the evidence bundle agree.

  Every immutable record is content-addressed. A changed input, rule, policy, or
  dependency gets a new identity, so an approval always refers to the thing that
  was approved.

  The package covers organizations and access, source ingestion with complete row
  accounting, the review state model, the release gate, dispositions and waivers,
  two-person approval, the evidence bundle, and the pull-request gate.

  Ingestion builds on `@grayhaven/nerve-importers` rather than repeating its CSV
  and XLSX parsing.

- 884acb5: Add the object store.

  Almost every record in the platform is immutable and already carries a
  content-addressed identity, so storing one is a mapping from fingerprint to
  record. What the store is for is the two things it refuses.

  A fingerprint cannot come to mean two different things: a record is rehashed
  on the way in and rejected if it does not match the identity it was filed
  under. And the one genuinely mutable fact, which release is current for a
  harness, moves only by compare-and-set, so a release cannot be lost to a
  race between two reviewers.

  The in-memory implementation is the reference a durable backend has to
  behave like.

### Patch Changes

- @grayhaven/nerve@7.1.0
- @grayhaven/nerve-importers@7.1.0
