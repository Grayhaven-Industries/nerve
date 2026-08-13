---
"@grayhaven/nerve-platform": minor
---

Add the platform package for reviewable harness releases.

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
