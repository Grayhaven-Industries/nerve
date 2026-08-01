/**
 * Built-in validation rules (PRD §9.4).
 *
 * All rules run against HIR only. Codes are stable; severities are defaults
 * that projects can override per-rule via `RuleConfig`
 * (e.g. `{ missingWireLength: "error" }`).
 */
import {
  DiagnosticSeverity,
  isPinEndpoint,
  refs,
  rule,
  type Hir,
  type HirEndpoint,
  type ElectricalConstraintKind,
  type PinElectrical,
  type Rule,
  type RuleContext,
  type ShopProfile
} from "@grayhaven/nerve"
import {
  AMPACITY_BY_AWG,
  differentialPartner,
  isGroundSignal,
  isPowerSignal,
  isShieldSignal,
  parseAwg,
  requiredAwgForCurrent,
  estimateBundleDiameterMm,
  INSULATED_OD_MM_BY_AWG,
  signalNominalVolts,
  sleeveCapacityMm
} from "./wire-data.js"
import { busTopologyRules } from "./bus-topology.js"
import { groundLoop, shieldTerminationScheme } from "./ground-shield.js"

const { Error: Err, Warning: Warn, Info } = DiagnosticSeverity

/**
 * Baseline version for every rule in this pack.
 *
 * A rule's verdict is a claim about the physical world, so it has to be
 * addressable independently of the toolchain release that shipped it: when a
 * harness fails in the field, "which rule logic passed it" must be answerable
 * without reconstructing a version of the CLI. Bump a rule's own `ruleVersion`
 * off this baseline when its logic changes such that the same HIR can get a
 * different verdict.
 *
 * @see docs/rule-coverage.md
 */
const RULE_VERSION = "1.0.0"

/**
 * On the absence of `standard` / `clause` in this file.
 *
 * Every rule below is annotated with `ruleVersion` and none with `standard`.
 * That is a finding, not an oversight. These rules are structural and
 * engineering-consistency invariants of Nerve's own model — a cavity count
 * against a housing, a reserved pin put into service, a differential half with
 * no partner — and they derive from the model, not from a governing document.
 *
 * The two candidates that look standards-shaped are not. The ampacity table in
 * `wire-data.ts` documents itself as "conservative bundled-harness values
 * (chassis-wiring tables derated for bundling)" with standards-informed data
 * deferred to a future rule pack, so HK-WIRE-004 and HK-ELEC-010 implement that
 * table, not a named standard. And PRD §38 names IPC/WHMA-A-620, IPC-D-620,
 * NASA-STD-8739.4, and SAE-AS50881 as *intended* rule-pack inputs; a roadmap
 * entry is not authority, and a PRD section is not a clause.
 *
 * The rule for adding one: cite `standard` only when this repository contains
 * the evidence that the rule implements that document. A fabricated citation
 * would destroy exactly the auditability the field exists to create, so an
 * omitted citation is the correct answer whenever the basis is not established.
 */

/**
 * On which rules call `ctx.measure`.
 *
 * A minority of the rules below take a measurement, and that is deliberate.
 * A margin is only meaningful where the claim rests on a continuous quantity
 * divided by a real budget in the same unit — current against ampacity,
 * ambient against a temperature rating, bundle diameter against a sleeve.
 * Those rules measure on every evaluation, passing or failing, because the
 * whole point is knowing how close a *passing* design sits to the edge.
 *
 * Everything else is left alone. Counting claims (cavities against pin count,
 * conductors in a cable, accessible pins on a net) look divisible but have no
 * gradient worth following: a fully-populated housing is the intended design,
 * not one at 100% of a budget, and an optimizer told otherwise would waste
 * cavities to buy a number. AWG range checks are worse still — AWG is an
 * inverted logarithmic scale, so a ratio of gauge numbers means nothing
 * physical. A fabricated slope is worse than a missing one.
 */

const endpointKey = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? `${e.connector}:${e.pin}` : `splice:${e.splice}`

/** Pins touched by at least one wire endpoint. */
const wiredPins = (hir: Hir): ReadonlySet<string> => {
  const set = new Set<string>()
  for (const w of hir.wires) {
    set.add(endpointKey(w.from))
    set.add(endpointKey(w.to))
  }
  return set
}

/** Wires whose endpoints both sit on a branch's path (splices count via their
 * branch assignment) — the same membership the bundle-diameter rule uses. */
const wiresOnBranch = (
  hir: Hir,
  branch: Hir["branches"][number]
): ReadonlyArray<Hir["wires"][number]> => {
  const onPath = new Set(branch.path)
  const spliceBranch = new Map(
    hir.splices.flatMap((sp) => (sp.branch !== undefined ? [[sp.id, sp.branch] as const] : []))
  )
  const nodeOnBranch = (e: HirEndpoint): boolean =>
    isPinEndpoint(e)
      ? onPath.has(e.connector)
      : spliceBranch.get(e.splice) === branch.id || onPath.has(e.splice)
  return hir.wires.filter((w) => nodeOnBranch(w.from) && nodeOnBranch(w.to))
}

// --- Documentation ----------------------------------------------------------

export const missingRevision: Rule = rule(
  "missingRevision",
  (ctx) => {
    if (ctx.hir.harness.revision.trim() === "") {
      ctx.report({
        severity: Err,
        message: `Harness ${ctx.hir.harness.id} has no revision.`
      })
    }
  },
  { code: "HK-DOC-001", ruleVersion: RULE_VERSION }
)

export const branchMissingLabel: Rule = rule(
  "branchMissingLabel",
  (ctx) => {
    const labeled = new Set(ctx.hir.labels.map((l) => l.attachTo))
    for (const b of ctx.hir.branches) {
      if (!labeled.has(b.id)) {
        ctx.report({
          severity: Warn,
          message: `Branch ${b.id} has no label attached.`,
          target: refs.branch(b.id)
        })
      }
    }
  },
  { code: "HK-DOC-002", ruleVersion: RULE_VERSION }
)

export const spliceMissingNotes: Rule = rule(
  "spliceMissingNotes",
  (ctx) => {
    for (const s of ctx.hir.splices) {
      if (s.notes === undefined && s.type === undefined && s.part === undefined) {
        ctx.report({
          severity: Warn,
          message: `Splice ${s.id} has no type, part, or manufacturing notes.`,
          target: refs.splice(s.id)
        })
      }
    }
  },
  { code: "HK-DOC-003", ruleVersion: RULE_VERSION }
)

// --- Manufacturing ----------------------------------------------------------

export const missingWireLength: Rule = rule(
  "missingWireLength",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.length === undefined) {
        ctx.report({
          severity: Warn,
          message: `Wire ${w.id} has no length; the cut list cannot include it.`,
          target: refs.wire(w.id)
        })
      }
    }
  },
  { code: "HK-MFG-001", ruleVersion: RULE_VERSION }
)

export const missingWireColor: Rule = rule(
  "missingWireColor",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.color === undefined) {
        ctx.report({
          severity: Err,
          message: `Wire ${w.id} has no color.`,
          target: refs.wire(w.id)
        })
      }
    }
  },
  { code: "HK-MFG-002", ruleVersion: RULE_VERSION }
)

export const missingWireGauge: Rule = rule(
  "missingWireGauge",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.gauge === undefined) {
        ctx.report({
          severity: Err,
          message: `Wire ${w.id} has no gauge.`,
          target: refs.wire(w.id)
        })
      }
    }
  },
  { code: "HK-MFG-003", ruleVersion: RULE_VERSION }
)

export const gaugeOutsideConnectorRange: Rule = rule(
  "gaugeOutsideConnectorRange",
  (ctx) => {
    const byRef = new Map(ctx.hir.connectors.map((c) => [c.ref, c]))
    for (const w of ctx.hir.wires) {
      const awg = w.gauge !== undefined ? parseAwg(w.gauge) : undefined
      if (awg === undefined) continue
      for (const end of [w.from, w.to]) {
        if (!isPinEndpoint(end)) continue
        const range = byRef.get(end.connector)?.wireGaugeRange
        if (range === undefined) continue
        const thinnest = parseAwg(range.min)
        const thickest = parseAwg(range.max)
        if (thinnest === undefined || thickest === undefined) continue
        // Larger AWG number = thinner wire.
        if (awg > thinnest || awg < thickest) {
          ctx.report({
            severity: Err,
            message: `Wire ${w.id} uses ${w.gauge} but connector ${end.connector} accepts ${range.max} to ${range.min}.`,
            target: refs.pin(end.connector, end.pin)
          })
        }
      }
    }
  },
  { code: "HK-MFG-004", ruleVersion: RULE_VERSION }
)

/** Well-formed metric cross-section, e.g. "0.5mm2" / "16 mm²". */
const isMetricGauge = (gauge: string): boolean =>
  /^\d+(\.\d+)?\s*mm(2|²)$/i.test(gauge.trim())

export const unparseableGauge: Rule = rule(
  "unparseableGauge",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.gauge === undefined) continue // HK-MFG-003's job
      if (parseAwg(w.gauge) !== undefined) continue
      // A well-formed metric gauge isn't an error — it's just outside the
      // AWG-keyed tables. Info, not a forever-Warning on every metric wire.
      if (isMetricGauge(w.gauge)) {
        ctx.report({
          severity: Info,
          message: `Wire ${w.id} uses metric gauge "${w.gauge}"; the AWG-based checks (HK-MFG-004, HK-WIRE-004, HK-MFG-006) don't apply.`,
          target: refs.wire(w.id)
        })
        continue
      }
      ctx.report({
        severity: Warn,
        message: `Wire ${w.id} gauge "${w.gauge}" is not recognized as AWG; gauge-based checks (HK-MFG-004, HK-WIRE-004, HK-MFG-006) cannot verify this wire.`,
        target: refs.wire(w.id)
      })
    }
  },
  { code: "HK-MFG-007", ruleVersion: RULE_VERSION }
)

// --- Electrical sanity ------------------------------------------------------

/** Shop-parameterized variant: the profile's ampacity table wins. */
export const gaugeCurrentMismatchWith = (shop?: ShopProfile): Rule => rule(
  "gaugeCurrentMismatch",
  (ctx) => {
    const table = { ...AMPACITY_BY_AWG, ...shop?.ampacityByAwg }
    for (const w of ctx.hir.wires) {
      if (w.currentEstimate === undefined || w.gauge === undefined) continue
      const awg = parseAwg(w.gauge)
      if (awg === undefined) continue
      const ampacity = table[awg]
      if (ampacity === undefined) continue
      // Measured on every wire, not only overloaded ones: a conductor at 40%
      // of its derated ampacity and one at 99% both pass, and which of the two
      // a design is sitting on is exactly what the pass bit discards.
      ctx.measure({
        target: refs.wire(w.id),
        quantity: "conductor current",
        measured: w.currentEstimate,
        limit: ampacity,
        unit: "A"
      })
      if (w.currentEstimate > ampacity) {
        const required = requiredAwgForCurrent(w.currentEstimate, table)
        const suffix =
          required !== undefined
            ? ` requires at least ${required}AWG`
            : ` exceeds the ampacity table`
        ctx.report({
          severity: Err,
          message: `Wire ${w.id} uses ${w.gauge} but its ${w.currentEstimate}A estimate${suffix}.`,
          target: refs.wire(w.id),
          data: {
            gauge: w.gauge,
            currentEstimateA: w.currentEstimate,
            ampacityA: ampacity,
            ...(required !== undefined ? { requiredGauge: `${required}AWG` } : {})
          }
        })
      }
    }
  },
  { code: "HK-WIRE-004", ruleVersion: RULE_VERSION }
)

export const gaugeCurrentMismatch: Rule = gaugeCurrentMismatchWith()

export const differentialPairNotTwisted: Rule = rule(
  "differentialPairNotTwisted",
  (ctx) => {
    const bySignal = new Map<string, Array<(typeof ctx.hir.wires)[number]>>()
    for (const w of ctx.hir.wires) {
      if (w.signal === undefined) continue
      const list = bySignal.get(w.signal.toUpperCase()) ?? []
      list.push(w)
      bySignal.set(w.signal.toUpperCase(), list)
    }
    for (const [signal, wires] of [...bySignal.entries()].sort()) {
      const partner = differentialPartner(signal)
      if (partner === undefined || !bySignal.has(partner)) continue
      // Report each pair once, from the lexically smaller signal.
      if (partner < signal) continue
      const partnerWires = bySignal.get(partner) ?? []
      for (const w of wires) {
        const mate = partnerWires.find(
          (p) => p.twistGroup !== undefined && p.twistGroup === w.twistGroup
        )
        if (w.twistGroup === undefined || mate === undefined) {
          ctx.report({
            severity: Err,
            message: `Differential pair ${signal}/${partner} (wire ${w.id}) must share a twist group.`,
            target: refs.wire(w.id),
            // Both halves of the pair are involved — badge them all.
            targets: partnerWires.map((p) => refs.wire(p.id)),
            data: { signal, partnerSignal: partner }
          })
        }
      }
    }
  },
  { code: "HK-ELEC-001", ruleVersion: RULE_VERSION }
)

export const twistGroupTooSmall: Rule = rule(
  "twistGroupTooSmall",
  (ctx) => {
    const counts = new Map<string, number>()
    for (const w of ctx.hir.wires) {
      if (w.twistGroup === undefined) continue
      counts.set(w.twistGroup, (counts.get(w.twistGroup) ?? 0) + 1)
    }
    for (const [group, count] of [...counts.entries()].sort()) {
      if (count < 2) {
        ctx.report({
          severity: Err,
          message: `Twist group ${group} contains only ${count} wire; twisting requires at least 2.`
        })
      }
    }
  },
  { code: "HK-ELEC-002", ruleVersion: RULE_VERSION }
)

export const missingGroundReturn: Rule = rule(
  "missingGroundReturn",
  (ctx) => {
    const signals = ctx.hir.wires
      .map((w) => w.signal)
      .filter((s): s is string => s !== undefined)
    const power = signals.filter(isPowerSignal)
    const hasGround = signals.some(isGroundSignal)
    if (power.length > 0 && !hasGround) {
      ctx.report({
        severity: Err,
        message: `Power signals (${[...new Set(power)].sort().join(", ")}) have no ground return wire.`
      })
    }
  },
  { code: "HK-ELEC-003", ruleVersion: RULE_VERSION }
)

export const shieldDrainUnconnected: Rule = rule(
  "shieldDrainUnconnected",
  (ctx) => {
    const wired = wiredPins(ctx.hir)
    for (const c of ctx.hir.connectors) {
      for (const p of c.pins) {
        if (p.signal === undefined || !isShieldSignal(p.signal)) continue
        if (!wired.has(`${c.ref}:${p.pin}`)) {
          ctx.report({
            severity: Warn,
            message: `Shield drain pin ${c.ref}.${p.pin} (${p.signal}) has no wire connected.`,
            target: refs.pin(c.ref, p.pin)
          })
        }
      }
    }
  },
  { code: "HK-ELEC-004", ruleVersion: RULE_VERSION }
)

// --- Connectivity -----------------------------------------------------------

export const unconnectedAssignedPin: Rule = rule(
  "unconnectedAssignedPin",
  (ctx) => {
    const wired = wiredPins(ctx.hir)
    for (const c of ctx.hir.connectors) {
      for (const p of c.pins) {
        if (p.signal === undefined) continue
        if (isShieldSignal(p.signal)) continue // covered by shieldDrainUnconnected
        if (!wired.has(`${c.ref}:${p.pin}`)) {
          ctx.report({
            severity: Warn,
            message: `Pin ${c.ref}.${p.pin} is assigned signal ${p.signal} but has no wire connected.`,
            target: refs.pin(c.ref, p.pin)
          })
        }
      }
    }
  },
  { code: "HK-CONN-010", ruleVersion: RULE_VERSION }
)

export const wireSignalMismatch: Rule = rule(
  "wireSignalMismatch",
  (ctx) => {
    const byRef = new Map(ctx.hir.connectors.map((c) => [c.ref, c]))
    for (const w of ctx.hir.wires) {
      if (w.signal === undefined) continue
      for (const end of [w.from, w.to]) {
        if (!isPinEndpoint(end)) continue
        const pinSignal = byRef
          .get(end.connector)
          ?.pins.find((p) => p.pin === end.pin)?.signal
        if (pinSignal !== undefined && pinSignal !== w.signal) {
          ctx.report({
            severity: Err,
            message: `Wire ${w.id} carries ${w.signal} but pin ${end.connector}.${end.pin} is assigned ${pinSignal}.`,
            target: refs.pin(end.connector, end.pin),
            targets: [refs.wire(w.id)],
            data: { wireSignal: w.signal, pinSignal }
          })
        }
      }
    }
  },
  { code: "HK-CONN-011", ruleVersion: RULE_VERSION }
)

// --- Component compatibility (PRD §30) ---------------------------------------

export const terminalIncompatible: Rule = rule(
  "terminalIncompatible",
  (ctx) => {
    for (const c of ctx.hir.connectors) {
      if (c.compatibleTerminals === undefined) continue
      for (const p of c.pins) {
        if (p.terminal !== undefined && !c.compatibleTerminals.includes(p.terminal)) {
          ctx.report({
            severity: Err,
            message: `Pin ${c.ref}.${p.pin} uses terminal ${p.terminal}, which is not compatible with ${c.mpn} (allowed: ${c.compatibleTerminals.join(", ")}).`,
            target: refs.pin(c.ref, p.pin)
          })
        }
      }
    }
  },
  { code: "HK-CONN-012", ruleVersion: RULE_VERSION }
)

/** A connector that publishes a terminal allow-list models removable crimp
 * contacts. Every wired cavity therefore needs an explicit terminal MPN;
 * connector families without such a list (solder cups, tabs, PCB headers)
 * are intentionally outside this rule. */
export const missingTerminal: Rule = rule(
  "missingTerminal",
  (ctx) => {
    const connectorByRef = new Map(ctx.hir.connectors.map((c) => [c.ref, c]))
    const seen = new Set<string>()
    for (const w of ctx.hir.wires) {
      for (const end of [w.from, w.to]) {
        if (!isPinEndpoint(end)) continue
        const key = `${end.connector}:${end.pin}`
        if (seen.has(key)) continue
        seen.add(key)
        const connector = connectorByRef.get(end.connector)
        if (connector?.compatibleTerminals === undefined || connector.compatibleTerminals.length === 0) {
          continue
        }
        const pin = connector.pins.find((p) => p.pin === end.pin)
        if (pin?.terminal !== undefined) continue
        ctx.report({
          severity: Err,
          message: `Wired pin ${end.connector}.${end.pin} has no terminal; ${connector.mpn} requires one of: ${connector.compatibleTerminals.join(", ")}.`,
          target: refs.pin(end.connector, end.pin),
          targets: [refs.wire(w.id)]
        })
      }
    }
  },
  { code: "HK-CONN-021", ruleVersion: RULE_VERSION }
)

export const missingSeal: Rule = rule(
  "missingSeal",
  (ctx) => {
    const wired = wiredPins(ctx.hir)
    for (const c of ctx.hir.connectors) {
      if (c.sealed !== true) continue
      for (const p of c.pins) {
        if (wired.has(`${c.ref}:${p.pin}`) && p.seal === undefined) {
          ctx.report({
            severity: Err,
            message: `Connector ${c.ref} (${c.mpn}) is sealed, but populated pin ${p.pin} has no seal assigned.`,
            target: refs.pin(c.ref, p.pin)
          })
        }
      }
    }
  },
  { code: "HK-CONN-013", ruleVersion: RULE_VERSION }
)

export const sealIncompatible: Rule = rule(
  "sealIncompatible",
  (ctx) => {
    for (const c of ctx.hir.connectors) {
      if (c.compatibleSeals === undefined) continue
      for (const p of c.pins) {
        if (p.seal !== undefined && !c.compatibleSeals.includes(p.seal)) {
          ctx.report({
            severity: Err,
            message: `Pin ${c.ref}.${p.pin} uses seal ${p.seal}, which is not compatible with ${c.mpn} (allowed: ${c.compatibleSeals.join(", ")}).`,
            target: refs.pin(c.ref, p.pin)
          })
        }
      }
    }
  },
  { code: "HK-CONN-014", ruleVersion: RULE_VERSION }
)

export const connectorCurrentExceeded: Rule = rule(
  "connectorCurrentExceeded",
  (ctx) => {
    const byRef = new Map(ctx.hir.connectors.map((c) => [c.ref, c]))
    for (const w of ctx.hir.wires) {
      if (w.currentEstimate === undefined) continue
      for (const end of [w.from, w.to]) {
        if (!isPinEndpoint(end)) continue
        const c = byRef.get(end.connector)
        if (c?.currentLimitA === undefined) continue
        // Per contact, not per wire: the same wire can be comfortable in one
        // housing and marginal in the other, and only the per-contact ratio
        // says which end to re-spec.
        ctx.measure({
          target: refs.pin(end.connector, end.pin),
          quantity: "contact current",
          measured: w.currentEstimate,
          limit: c.currentLimitA,
          unit: "A"
        })
        if (w.currentEstimate > c.currentLimitA) {
          ctx.report({
            severity: Err,
            message: `Wire ${w.id} estimates ${w.currentEstimate}A but connector ${end.connector} (${c.mpn}) contacts are rated ${c.currentLimitA}A.`,
            target: refs.pin(end.connector, end.pin),
            targets: [refs.wire(w.id)],
            data: { currentEstimateA: w.currentEstimate, currentLimitA: c.currentLimitA }
          })
        }
      }
    }
  },
  { code: "HK-CONN-016", ruleVersion: RULE_VERSION }
)

export const connectorVoltageExceeded: Rule = rule(
  "connectorVoltageExceeded",
  (ctx) => {
    const byRef = new Map(ctx.hir.connectors.map((c) => [c.ref, c]))
    for (const w of ctx.hir.wires) {
      if (w.signal === undefined) continue
      // Voltage is INFERRED from the signal name, so only trust it for
      // rail-shaped names (isPowerSignal is anchored precisely to exclude
      // FB_400V / EN_48V / SENSE_24V, which carry logic levels). And even
      // then it's an inference — Warning, not a fail-closed Error.
      if (!isPowerSignal(w.signal)) continue
      const nominal = signalNominalVolts(w.signal)
      if (nominal === undefined) continue
      for (const end of [w.from, w.to]) {
        if (!isPinEndpoint(end)) continue
        const c = byRef.get(end.connector)
        if (c?.voltageLimitV === undefined) continue
        // The nominal is an inference (see above), but it is the same
        // inference the finding rests on — so it is measured on the passing
        // path under exactly the conditions that would have reported it.
        ctx.measure({
          target: refs.pin(end.connector, end.pin),
          quantity: "contact voltage",
          measured: nominal,
          limit: c.voltageLimitV,
          unit: "V"
        })
        if (nominal > c.voltageLimitV) {
          ctx.report({
            severity: Warn,
            message: `Wire ${w.id} carries ${w.signal} (nominal ${nominal}V inferred from its name) but connector ${end.connector} (${c.mpn}) is rated ${c.voltageLimitV}V.`,
            target: refs.pin(end.connector, end.pin),
            targets: [refs.wire(w.id)],
            data: { nominalV: nominal, voltageLimitV: c.voltageLimitV }
          })
        }
      }
    }
  },
  { code: "HK-CONN-017", ruleVersion: RULE_VERSION }
)

/**
 * Org approval gate (PRD §30 acceptance: organizations override approval
 * state without mutating library data). Pass the approved MPN list from
 * org config; anything else in the BOM is flagged.
 */
export const requireApprovedParts = (approvedMpns: ReadonlyArray<string>): Rule => {
  const approved = new Set(approvedMpns)
  return rule(
    "requireApprovedParts",
    (ctx) => {
      for (const item of ctx.hir.bom) {
        if (!approved.has(item.mpn)) {
          ctx.report({
            severity: Warn,
            message: `Part ${item.mpn} (${item.category ?? "part"}) is not on the approved parts list.`,
            target: refs.bom(item.mpn)
          })
        }
      }
    },
    { code: "HK-DOC-004", ruleVersion: RULE_VERSION }
  )
}

/** All built-in rules, in stable order. */

export const voltageRatingBelowSignal: Rule = rule(
  "voltageRatingBelowSignal",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.voltageRating === undefined || w.signal === undefined) continue
      const nominal = signalNominalVolts(w.signal)
      if (nominal === undefined) continue
      // Insulation headroom: a 24V rail in 30V-rated insulation passes, but
      // it is a different design from the same rail in 600V insulation.
      ctx.measure({
        target: refs.wire(w.id),
        quantity: "insulation voltage",
        measured: nominal,
        limit: w.voltageRating,
        unit: "V"
      })
      if (w.voltageRating < nominal) {
        ctx.report({
          severity: Err,
          message: `Wire ${w.id} is rated ${w.voltageRating}V but carries ${w.signal} (nominal ${nominal}V).`,
          target: refs.wire(w.id)
        })
      }
    }
  },
  { code: "HK-ELEC-005", ruleVersion: RULE_VERSION }
)

export const reservedPinAssigned: Rule = rule(
  "reservedPinAssigned",
  (ctx) => {
    const wired = wiredPins(ctx.hir)
    for (const c of ctx.hir.connectors) {
      if (c.reservedPins === undefined) continue
      for (const pin of c.reservedPins) {
        const p = c.pins.find((x) => x.pin === pin)
        const landed = wired.has(`${c.ref}:${pin}`)
        // Any sign the cavity was put into service violates the keep-out.
        const how =
          p?.signal !== undefined
            ? `carries ${p.signal}`
            : landed
              ? "has a wire landed on it"
              : p?.terminal !== undefined
                ? `has terminal ${p.terminal} populated`
                : p?.seal !== undefined
                  ? `has seal ${p.seal} populated`
                  : undefined
        if (how !== undefined) {
          ctx.report({
            severity: Err,
            message: `Connector ${c.ref} pin ${pin} is reserved but ${how}.`,
            target: refs.pin(c.ref, pin)
          })
        }
      }
    }
  },
  { code: "HK-CONN-015", ruleVersion: RULE_VERSION }
)

/** Shop-parameterized variant: the profile's default bend radius applies
 * to branches that declare none. */
export const breakoutTighterThanBendRadiusWith = (shop?: ShopProfile): Rule => rule(
  "breakoutTighterThanBendRadius",
  (ctx) => {
    for (const b of ctx.hir.branches) {
      const minBend = b.minBendRadius ?? shop?.defaultMinBendRadiusMm
      if (minBend === undefined || b.breakoutDistance === undefined) continue
      // Demand over budget, so the ratio keeps the shared "< 1 passes"
      // direction: the bend radius the bundle needs is what is spent, and the
      // distance available before the breakout is the budget it spends from.
      ctx.measure({
        target: refs.branch(b.id),
        quantity: "bend radius",
        measured: minBend,
        limit: b.breakoutDistance,
        unit: ctx.hir.harness.units
      })
      if (b.breakoutDistance < minBend) {
        ctx.report({
          severity: Err,
          message: `Branch ${b.id} breaks out ${b.breakoutDistance}mm from its parent but the bundle needs a ${minBend}mm bend radius.`,
          target: refs.branch(b.id),
          data: { breakoutDistanceMm: b.breakoutDistance, minBendRadiusMm: minBend }
        })
      }
    }
  },
  { code: "HK-MFG-005", ruleVersion: RULE_VERSION }
)

export const breakoutTighterThanBendRadius: Rule = breakoutTighterThanBendRadiusWith()

/** Shop-parameterized variant: profile sleeve capacities, OD table, and
 * packing factor win over the bundled defaults. */
export const bundleOverSleeveCapacityWith = (shop?: ShopProfile): Rule => rule(
  "bundleOverSleeveCapacity",
  (ctx) => {
    const odTable = { ...INSULATED_OD_MM_BY_AWG, ...shop?.insulatedOdMmByAwg }
    // Member wires: both endpoints' nodes sit on the branch path (splices
    // count via their branch assignment).
    const spliceBranch = new Map(
      ctx.hir.splices.flatMap((sp) => (sp.branch !== undefined ? [[sp.id, sp.branch] as const] : []))
    )
    for (const b of ctx.hir.branches) {
      if (b.sleeve === undefined) continue
      const capacity = shop?.sleeveCapacityMm?.[b.sleeve] ?? sleeveCapacityMm(b.sleeve)
      if (capacity === undefined) continue
      const onBranch = new Set(b.path)
      const nodeOnBranch = (e: (typeof ctx.hir.wires)[number]["from"]): boolean =>
        "connector" in e ? onBranch.has(e.connector) : spliceBranch.get(e.splice) === b.id || onBranch.has(e.splice)
      const ods: Array<number> = []
      const memberWires: Array<string> = []
      for (const w of ctx.hir.wires) {
        if (!nodeOnBranch(w.from) || !nodeOnBranch(w.to)) continue
        const awg = w.gauge !== undefined ? parseAwg(w.gauge) : undefined
        const od = awg !== undefined ? odTable[awg] : undefined
        if (od !== undefined) {
          ods.push(od)
          memberWires.push(w.id)
        }
      }
      if (ods.length === 0) continue
      const estimated = estimateBundleDiameterMm(ods, shop?.bundlePackingFactor)
      // Millimetres regardless of `harness.units`: both sides come from mm
      // reference data (the insulated-OD table and the sleeve's mm size), not
      // from harness geometry.
      ctx.measure({
        target: refs.branch(b.id),
        quantity: "sleeve fill",
        measured: estimated,
        limit: capacity,
        unit: "mm"
      })
      if (estimated > capacity) {
        ctx.report({
          severity: Err,
          message: `Branch ${b.id} bundle is ~${estimated.toFixed(1)}mm across ${ods.length} wires but sleeve ${b.sleeve} takes ${capacity}mm.`,
          target: refs.branch(b.id),
          targets: memberWires.map(refs.wire),
          data: {
            estimatedBundleMm: Number(estimated.toFixed(1)),
            sleeveCapacityMm: capacity,
            wireCount: ods.length,
            sleeve: b.sleeve
          }
        })
      }
    }
  },
  { code: "HK-MFG-006", ruleVersion: RULE_VERSION }
)

export const bundleOverSleeveCapacity: Rule = bundleOverSleeveCapacityWith()

// --- Structural integrity (rule layer; the compiler already catches
// undefined/duplicate refs as HK-CONN-001/002/003, HK-WIRE-001/002,
// HK-BRANCH-001/002, HK-SPLICE-001..004, HK-CABLE-001/002 — these check the
// well-formedness it leaves on the table) ------------------------------------

/** Wires of DIFFERING gauge crimped into one contact: the terminal can't
 * compress two unlike cross-sections reliably, so the join pulls out or runs
 * hot. A same-gauge double-crimp is a legitimate distribution pattern (one
 * power/ground pin feeding several downstream loads), so it isn't flagged.
 * Splice endpoints legitimately fan out, so only pin endpoints count.
 *
 * Opt-in (not in `builtinRules`): some shops intentionally consolidate
 * mixed-gauge returns onto one contact, so this ships off by default — enable
 * it where A-620-style single-gauge-per-contact is a house rule. */
export const multipleWiresIntoPin: Rule = rule(
  "multipleWiresIntoPin",
  (ctx) => {
    const byPin = new Map<
      string,
      { connector: string; pin: string; wires: Array<string>; gauges: Set<string> }
    >()
    for (const w of ctx.hir.wires) {
      for (const end of [w.from, w.to]) {
        if (!isPinEndpoint(end)) continue
        const key = `${end.connector}:${end.pin}`
        const entry =
          byPin.get(key) ??
          { connector: end.connector, pin: end.pin, wires: [], gauges: new Set<string>() }
        entry.wires.push(w.id)
        if (w.gauge !== undefined) entry.gauges.add(w.gauge)
        byPin.set(key, entry)
      }
    }
    for (const e of byPin.values()) {
      // Two or more wires of genuinely different gauges in one contact.
      if (e.wires.length < 2 || e.gauges.size < 2) continue
      ctx.report({
        severity: Err,
        message: `Pin ${e.connector}.${e.pin} has ${e.wires.length} wires of differing gauge crimped into one contact (${[...e.gauges].sort().join(", ")}).`,
        target: refs.pin(e.connector, e.pin),
        targets: e.wires.sort().map(refs.wire),
        data: { wireCount: e.wires.length, gauges: [...e.gauges].sort().join(", ") }
      })
    }
  },
  { code: "HK-CONN-018", ruleVersion: RULE_VERSION }
)

/** A connector cannot have more populated cavities than the housing has. */
export const contactCountExceedsPinCount: Rule = rule(
  "contactCountExceedsPinCount",
  (ctx) => {
    for (const c of ctx.hir.connectors) {
      if (c.pins.length > c.pinCount) {
        ctx.report({
          severity: Err,
          message: `Connector ${c.ref} (${c.mpn}) declares ${c.pins.length} pins but the housing has only ${c.pinCount} cavities.`,
          target: refs.connector(c.ref),
          data: { declaredPins: c.pins.length, pinCount: c.pinCount }
        })
      }
    }
  },
  { code: "HK-CONN-019", ruleVersion: RULE_VERSION }
)

/** A declared cavity grid must account for exactly the housing's cavities. */
export const cavityLayoutMismatch: Rule = rule(
  "cavityLayoutMismatch",
  (ctx) => {
    for (const c of ctx.hir.connectors) {
      if (c.cavityLayout === undefined) continue
      const cells = c.cavityLayout.rows * c.cavityLayout.columns
      if (cells !== c.pinCount) {
        ctx.report({
          severity: Err,
          message: `Connector ${c.ref} (${c.mpn}) cavity layout ${c.cavityLayout.rows}×${c.cavityLayout.columns} = ${cells} does not match its ${c.pinCount}-cavity pin count.`,
          target: refs.connector(c.ref),
          data: { rows: c.cavityLayout.rows, columns: c.cavityLayout.columns, pinCount: c.pinCount }
        })
      }
    }
  },
  { code: "HK-CONN-020", ruleVersion: RULE_VERSION }
)

/** A length of zero or below is a unit-entry error; cut lists need real mm. */
export const nonPositiveWireLength: Rule = rule(
  "nonPositiveWireLength",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.length !== undefined && w.length <= 0) {
        ctx.report({
          severity: Err,
          message: `Wire ${w.id} has a non-positive length (${w.length}); the cut list and routing need a real length.`,
          target: refs.wire(w.id),
          data: { length: w.length }
        })
      }
    }
  },
  { code: "HK-MFG-008", ruleVersion: RULE_VERSION }
)

/** Branch `parent` is carried into HIR but not validated by the compiler:
 * a parent naming no branch, or a parent chain that loops, makes the routed
 * tree unbuildable. */
export const branchParentInvalid: Rule = rule(
  "branchParentInvalid",
  (ctx) => {
    const byId = new Map(ctx.hir.branches.map((b) => [b.id, b]))
    for (const b of ctx.hir.branches) {
      if (b.parent === undefined) continue
      if (!byId.has(b.parent)) {
        ctx.report({
          severity: Err,
          message: `Branch ${b.id} names parent ${b.parent}, which is not a defined branch.`,
          target: refs.branch(b.id),
          data: { parent: b.parent }
        })
        continue
      }
      // Walk parents to a root; revisiting a branch means a cycle.
      const seen = new Set<string>([b.id])
      let cur: string | undefined = b.parent
      while (cur !== undefined) {
        if (seen.has(cur)) {
          ctx.report({
            severity: Err,
            message: `Branch ${b.id} sits in a parent cycle (reaches ${cur} again); the branch tree must be acyclic.`,
            target: refs.branch(b.id),
            data: { parent: b.parent }
          })
          break
        }
        seen.add(cur)
        cur = byId.get(cur)?.parent
      }
    }
  },
  { code: "HK-MFG-009", ruleVersion: RULE_VERSION }
)

/** A cable cannot carry more member wires than it has conductors. (Under-fill
 * is legal — those are spare conductors — so only an overflow is flagged.) */
export const cableConductorOverflow: Rule = rule(
  "cableConductorOverflow",
  (ctx) => {
    for (const c of ctx.hir.cables) {
      if (c.conductors === undefined) continue
      if (c.wires.length > c.conductors) {
        ctx.report({
          severity: Err,
          message: `Cable ${c.id} carries ${c.wires.length} wires but is a ${c.conductors}-conductor cable.`,
          target: `cable:${c.id}`,
          targets: [...c.wires].sort().map(refs.wire),
          data: { memberWires: c.wires.length, conductors: c.conductors }
        })
      }
    }
  },
  { code: "HK-MFG-010", ruleVersion: RULE_VERSION }
)

/** Cable membership without a conductor identity is valid as an early design
 * sketch, but is ambiguous for cut lists, connector pinouts, and test repair. */
export const missingCableConductor: Rule = rule(
  "missingCableConductor",
  (ctx) => {
    for (const w of ctx.hir.wires) {
      if (w.cable === undefined || w.conductor !== undefined) continue
      ctx.report({
        severity: Warn,
        message: `Wire ${w.id} belongs to cable ${w.cable} but does not identify which conductor it uses.`,
        target: refs.wire(w.id),
        data: { cable: w.cable }
      })
    }
  },
  { code: "HK-MFG-011", ruleVersion: RULE_VERSION }
)

/** A named bus differential half (CAN/RS-485/USB) whose partner appears on no
 * wire. HK-ELEC-001 only fires once BOTH halves exist; this catches the
 * lone-half case. Restricted to strong bus patterns so an incidentally
 * `_P`/`_N`-suffixed single-ended signal isn't misread as differential. */
const STRONG_DIFFERENTIAL = /(CAN\d*_?[HL]|RS485_?[AB]|USB_?D[PM])$/i

export const orphanedDifferentialHalf: Rule = rule(
  "orphanedDifferentialHalf",
  (ctx) => {
    const present = new Set<string>()
    for (const w of ctx.hir.wires) {
      if (w.signal !== undefined) present.add(w.signal.toUpperCase())
    }
    const reported = new Set<string>()
    for (const w of ctx.hir.wires) {
      if (w.signal === undefined) continue
      const sig = w.signal.toUpperCase()
      if (!STRONG_DIFFERENTIAL.test(sig) || reported.has(sig)) continue
      const partner = differentialPartner(sig)
      if (partner === undefined || present.has(partner)) continue
      reported.add(sig)
      ctx.report({
        severity: Err,
        message: `Differential signal ${w.signal} has no partner ${partner} anywhere in the harness; a bus pair needs both halves.`,
        target: refs.wire(w.id),
        data: { signal: w.signal, missingPartner: partner }
      })
    }
  },
  { code: "HK-ELEC-006", ruleVersion: RULE_VERSION }
)

/** Wires sharing a twist group should share a gauge — a gauge mismatch within
 * a twisted pair introduces skew and impedance imbalance. */
export const twistGroupGaugeMismatch: Rule = rule(
  "twistGroupGaugeMismatch",
  (ctx) => {
    const byGroup = new Map<string, { wires: Array<string>; gauges: Set<string> }>()
    for (const w of ctx.hir.wires) {
      if (w.twistGroup === undefined || w.gauge === undefined) continue
      const entry = byGroup.get(w.twistGroup) ?? { wires: [], gauges: new Set<string>() }
      entry.wires.push(w.id)
      entry.gauges.add(w.gauge)
      byGroup.set(w.twistGroup, entry)
    }
    for (const [group, e] of byGroup) {
      if (e.gauges.size <= 1) continue
      ctx.report({
        severity: Warn,
        message: `Twist group ${group} mixes gauges (${[...e.gauges].sort().join(", ")}); a twisted pair should be a matched gauge to limit skew.`,
        targets: [...e.wires].sort().map(refs.wire),
        data: { group, gauges: [...e.gauges].sort().join(", ") }
      })
    }
  },
  { code: "HK-ELEC-007", ruleVersion: RULE_VERSION }
)

// --- EMC / environment / protection (HIR §tier-2 fields) --------------------

/** A noisy "aggressor" wire and a sensitive "victim" wire bundled on the same
 * branch couple crosstalk — they should route in separate bundles. Only fires
 * when wires are explicitly classified via `emcClass`. */
export const emcAggressorVictimShareBranch: Rule = rule(
  "emcAggressorVictimShareBranch",
  (ctx) => {
    for (const b of ctx.hir.branches) {
      const members = wiresOnBranch(ctx.hir, b)
      const aggressors = members.filter((w) => w.emcClass === "aggressor")
      const victims = members.filter((w) => w.emcClass === "victim")
      if (aggressors.length === 0 || victims.length === 0) continue
      ctx.report({
        severity: Warn,
        message: `Branch ${b.id} bundles aggressor wire(s) (${aggressors.map((w) => w.id).sort().join(", ")}) with victim wire(s) (${victims.map((w) => w.id).sort().join(", ")}); separate them to limit crosstalk.`,
        target: refs.branch(b.id),
        targets: [...aggressors, ...victims].map((w) => refs.wire(w.id)).sort(),
        data: { aggressors: aggressors.length, victims: victims.length }
      })
    }
  },
  { code: "HK-ELEC-008", ruleVersion: RULE_VERSION }
)

/** A wire routed through a branch hotter than its insulation rating will
 * degrade. Fires when a branch declares an ambient above a member wire's
 * temperatureRating. */
export const wireTempBelowAmbient: Rule = rule(
  "wireTempBelowAmbient",
  (ctx) => {
    for (const b of ctx.hir.branches) {
      if (b.ambientTemperatureC === undefined) continue
      for (const w of wiresOnBranch(ctx.hir, b)) {
        if (w.temperatureRating === undefined) continue
        // Ambient over rating: a 105°C wire in an 100°C branch passes with
        // almost nothing left, and that is invisible in the verdict.
        ctx.measure({
          target: refs.wire(w.id),
          quantity: "conductor temperature",
          measured: b.ambientTemperatureC,
          limit: w.temperatureRating,
          unit: "°C"
        })
        if (w.temperatureRating < b.ambientTemperatureC) {
          ctx.report({
            severity: Err,
            message: `Wire ${w.id} is rated ${w.temperatureRating}°C but branch ${b.id} runs at ${b.ambientTemperatureC}°C ambient.`,
            target: refs.wire(w.id),
            targets: [refs.branch(b.id)],
            data: { temperatureRating: w.temperatureRating, ambientTemperatureC: b.ambientTemperatureC }
          })
        }
      }
    }
  },
  { code: "HK-ELEC-009", ruleVersion: RULE_VERSION }
)

/** The cardinal protection rule: an overcurrent device must trip before the
 * wire it guards overheats, so its rating cannot exceed the ampacity of the
 * thinnest conductor it protects — otherwise "the wire becomes the fuse."
 * Shop-parameterized so the ampacity table can be overridden. */
export const overcurrentExceedsConductorWith = (shop?: ShopProfile): Rule => rule(
  "overcurrentExceedsConductor",
  (ctx) => {
    const protections = ctx.hir.protections ?? []
    if (protections.length === 0) return
    const table = { ...AMPACITY_BY_AWG, ...shop?.ampacityByAwg }
    const wireById = new Map(ctx.hir.wires.map((w) => [w.id, w]))
    for (const p of protections) {
      let governing: { wireId: string; ampacity: number } | undefined
      for (const wireId of p.protects) {
        const w = wireById.get(wireId)
        if (w?.gauge === undefined) continue
        const awg = parseAwg(w.gauge)
        if (awg === undefined) continue
        const ampacity = table[awg]
        if (ampacity === undefined) continue
        if (governing === undefined || ampacity < governing.ampacity) {
          governing = { wireId, ampacity }
        }
      }
      if (governing === undefined) continue
      // How much of the governing conductor's ampacity the device is allowed
      // to let through before it trips — the coordination headroom, which is
      // the thing that gets eaten silently when a gauge is thinned.
      ctx.measure({
        target: `protection:${p.id}`,
        quantity: "overcurrent rating",
        measured: p.ratingA,
        limit: governing.ampacity,
        unit: "A"
      })
      if (p.ratingA > governing.ampacity) {
        ctx.report({
          severity: Err,
          message: `${p.kind} ${p.id} is rated ${p.ratingA}A but its thinnest protected wire ${governing.wireId} carries only ${governing.ampacity}A; the wire would fail before the device trips.`,
          target: `protection:${p.id}`,
          targets: [refs.wire(governing.wireId)],
          data: { ratingA: p.ratingA, conductorAmpacityA: governing.ampacity, governingWire: governing.wireId }
        })
      }
    }
  },
  { code: "HK-ELEC-010", ruleVersion: RULE_VERSION }
)

export const overcurrentExceedsConductor: Rule = overcurrentExceedsConductorWith()

/** A continuity test needs two physically accessible connector pins. A net
 * with fewer points is an incomplete physical topology, even when its splice
 * graph is electrically connected in the abstract. */
export const uncoveredNet: Rule = rule(
  "uncoveredNet",
  (ctx) => {
    const byRoot = new Map<
      string,
      { name: string; pins: Set<string>; wires: Array<string> }
    >()
    for (const w of ctx.hir.wires) {
      const root = ctx.nets.rootOf(w.from)
      const entry = byRoot.get(root) ?? {
        name: ctx.nets.nameOf(w.from) ?? root,
        pins: new Set<string>(),
        wires: []
      }
      entry.wires.push(w.id)
      for (const end of [w.from, w.to]) {
        if (isPinEndpoint(end)) entry.pins.add(refs.pin(end.connector, end.pin))
      }
      byRoot.set(root, entry)
    }
    for (const entry of [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.pins.size >= 2) continue
      const wires = [...entry.wires].sort()
      ctx.report({
        severity: Err,
        message: `Net ${entry.name} reaches ${entry.pins.size} accessible connector pin${entry.pins.size === 1 ? "" : "s"}; continuity coverage requires at least 2.`,
        target: refs.wire(wires[0]!),
        targets: wires.slice(1).map(refs.wire),
        data: { accessiblePins: entry.pins.size, wireCount: wires.length }
      })
    }
  },
  { code: "HK-ELEC-011", ruleVersion: RULE_VERSION }
)

/** Adapt one core electrical-analysis finding kind into an independently
 * configurable built-in rule. The analyzer owns inference; this layer only
 * assigns the stable rule name, code, and default severity. */
const electricalFindingRule = (
  name: string,
  kind: ElectricalConstraintKind,
  severity: typeof Err | typeof Warn,
  code: string,
  /** Optional continuous channel. Only the current-budget kind has one; the
   * rest of the analyzer's findings are discrete relations (two sources, a
   * protocol clash) with no gradient to follow. */
  measure?: (ctx: RuleContext) => void
): Rule => rule(
  name,
  (ctx: RuleContext) => {
    for (const finding of ctx.electrical.findings) {
      if (finding.kind !== kind) continue
      const [target, ...targets] = finding.pins
      ctx.report({
        severity,
        message: finding.message,
        ...(target !== undefined ? { target } : {}),
        ...(targets.length > 0 ? { targets } : {}),
        ...(finding.data !== undefined ? { data: finding.data } : {})
      })
    }
    measure?.(ctx)
  },
  { code, ruleVersion: RULE_VERSION }
)

/** A pin's declared current, on the analyzer's own terms: only a finite,
 * positive figure is a declaration. */
const declaredCurrentA = (electrical: PinElectrical): number | undefined =>
  electrical.currentA !== undefined &&
  Number.isFinite(electrical.currentA) &&
  electrical.currentA > 0
    ? electrical.currentA
    : undefined

/**
 * Summed sink demand against the single source's capacity, per net, whether
 * or not it overflows — the analyzer only emits a finding once demand wins,
 * so the passing ratio has to be recomputed here to exist at all.
 *
 * The guards mirror the analyzer exactly (one declared source, positive
 * declared currents): a net with sinks that declare no current has *unknown*
 * demand, not zero demand, so it is measured as nothing rather than as slack.
 */
const measureSourceCurrent = (ctx: RuleContext): void => {
  for (const net of ctx.electrical.nets) {
    const sources = net.pins.filter((pin) => pin.electrical.role === "source")
    const source = sources.length === 1 ? sources[0] : undefined
    if (source === undefined) continue
    const capacityA = declaredCurrentA(source.electrical)
    if (capacityA === undefined) continue
    const demands = net.pins.flatMap((pin) => {
      if (pin.electrical.role !== "sink") return []
      const demandA = declaredCurrentA(pin.electrical)
      return demandA === undefined ? [] : [demandA]
    })
    if (demands.length === 0) continue
    ctx.measure({
      target: source.ref,
      quantity: "source current",
      measured: demands.reduce((sum, demandA) => sum + demandA, 0),
      limit: capacityA,
      unit: "A"
    })
  }
}

export const multipleElectricalSources: Rule = electricalFindingRule(
  "multipleElectricalSources",
  "multiple-sources",
  Err,
  "HK-ELEC-012"
)

export const undrivenElectricalLoad: Rule = electricalFindingRule(
  "undrivenElectricalLoad",
  "undriven-load",
  Warn,
  "HK-ELEC-013"
)

export const voltageDomainMismatch: Rule = electricalFindingRule(
  "voltageDomainMismatch",
  "voltage-incompatible",
  Err,
  "HK-ELEC-014"
)

export const protocolMismatch: Rule = electricalFindingRule(
  "protocolMismatch",
  "protocol-mismatch",
  Err,
  "HK-ELEC-015"
)

export const differentialSemanticConflict: Rule = electricalFindingRule(
  "differentialSemanticConflict",
  "differential-conflict",
  Err,
  "HK-ELEC-016"
)

export const sourceCurrentExceeded: Rule = electricalFindingRule(
  "sourceCurrentExceeded",
  "source-current-exceeded",
  Err,
  "HK-ELEC-017",
  measureSourceCurrent
)

/**
 * builtinRules with the shop-capability rules parameterized by a profile
 * (PRD §10.5 config: `defineConfig({ shop: { … } })`). Same rule names and
 * codes, so RuleConfig severity overrides apply unchanged.
 */
export const builtinRulesWith = (shop?: ShopProfile): ReadonlyArray<Rule> =>
  shop === undefined
    ? builtinRules
    : builtinRules.map((r) =>
        r.name === "gaugeCurrentMismatch"
          ? gaugeCurrentMismatchWith(shop)
          : r.name === "bundleOverSleeveCapacity"
            ? bundleOverSleeveCapacityWith(shop)
            : r.name === "breakoutTighterThanBendRadius"
              ? breakoutTighterThanBendRadiusWith(shop)
              : r.name === "overcurrentExceedsConductor"
                ? overcurrentExceedsConductorWith(shop)
                : r
      )

export const builtinRules: ReadonlyArray<Rule> = [
  missingRevision,
  branchMissingLabel,
  spliceMissingNotes,
  missingWireLength,
  missingWireColor,
  missingWireGauge,
  gaugeOutsideConnectorRange,
  unparseableGauge,
  gaugeCurrentMismatch,
  differentialPairNotTwisted,
  twistGroupTooSmall,
  missingGroundReturn,
  shieldDrainUnconnected,
  unconnectedAssignedPin,
  wireSignalMismatch,
  terminalIncompatible,
  missingTerminal,
  missingSeal,
  sealIncompatible,
  connectorCurrentExceeded,
  connectorVoltageExceeded,
  voltageRatingBelowSignal,
  reservedPinAssigned,
  breakoutTighterThanBendRadius,
  bundleOverSleeveCapacity,
  contactCountExceedsPinCount,
  cavityLayoutMismatch,
  nonPositiveWireLength,
  branchParentInvalid,
  cableConductorOverflow,
  missingCableConductor,
  orphanedDifferentialHalf,
  twistGroupGaugeMismatch,
  emcAggressorVictimShareBranch,
  wireTempBelowAmbient,
  overcurrentExceedsConductor,
  uncoveredNet,
  multipleElectricalSources,
  undrivenElectricalLoad,
  voltageDomainMismatch,
  protocolMismatch,
  differentialSemanticConflict,
  sourceCurrentExceeded,
  // Bus and return-path topology (ISO 11898-2 / grounding convention).
  // Pure graph analysis over HIR — no part data or geometry required.
  ...busTopologyRules,
  groundLoop,
  shieldTerminationScheme
]
