# @grayhaven/nerve-interop

Deterministic, loss-aware interoperability primitives for Grayhaven Nerve.

This package deliberately does **not** certify a harness, reproduce licensed
standards text, supply normative acceptance values, implement an OPC UA
transport, or parse official VEC XML. It provides four bounded building blocks:

- standards profiles that identify exact authorities, revisions, scope,
  applicability, parameter sources, reviewers, and evidence layers;
- a normalized structured VEC 2.2 subset adapter for connectors, pins,
  terminals, seals, and point-to-point wires;
- transport-neutral OPC UA 40570 v1 job/result mappings for its initial
  single-core, single-layer cut/strip/crimp/seal scope; and
- caller-parameterized automation-data and high-voltage design-readiness
  evaluations.

## Important scope limits

`Vec22SubsetDocument` is an interchange DTO, not an XML parser and not proof
of VEC conformance. The caller owns the official VEC XML XSD/ontology/SHACL
toolchain and supplies validator identity, version, pass state, and report
hash. Unknown extensions carry their source path and either lossless JSON or a
raw artifact reference/hash so the adapter does not silently discard them.
The public version and semantic-validation context is maintained by prostep
ivip in the [VEC 2.2.0 specification](https://ecad-wiki.prostep.org/specifications/vec/v220/)
and [compliance-test guidance](https://ecad-wiki.prostep.org/specifications/vec/guidelines/compliance-tests/).

The OPC mapping follows the public scope of OPC 40570 v1.0.0, published
2025-04-01: <https://reference.opcfoundation.org/specs/OPC-40570>. It is not an
OPC UA client, binding, certificate, assembly protocol, or end-of-line tester
protocol. It never invents a cut, strip, terminal, seal, or process value.

Automation findings evaluate only requirements selected by the caller. A
profile may cite DIN 72036 or another source, but a result is not a DIN or
other standards-conformity determination. High-voltage evaluation compares
only caller-declared voltage domains against facts present in HIR. HIR does not
currently establish HVIL function, physical segregation/clearance, or shield
grounding, so those declarations remain `unassessed`. No hipot voltage, ramp,
dwell, leakage, clearance, or insulation-resistance threshold is synthesized.
The current publication identity for the automation-oriented design standard
is [DIN 72036:2026-04](https://www.dinmedia.de/en/standard/din-72036/398287446);
this package contains none of its licensed rules.

Standards profiles may contain references and caller-controlled identifiers;
they are not a home for copied tables, standard prose, acceptance values, or
claims such as “certified” or “compliant.”
