/**
 * Part-pinout contract rules (HK-CONN-023, HK-CONN-024).
 *
 * Every other connector rule in this pack judges a design against itself.
 * HK-CONN-011 is the closest thing the rule set has to a pin check, and it
 * compares a wire's declared signal against the pin assignment it lands on —
 * but one author writes both, in the same file, in the same sitting. A pinout
 * that is *consistently* wrong therefore agrees with itself and compiles
 * clean, and a consistently wrong pinout is the mistake people actually make:
 * the connector goes in rotated, the datasheet was read bottom-view, the pin 1
 * chamfer is on the other end than assumed. Nothing in the harness can catch
 * that, because nothing in the harness disagrees.
 *
 * These two rules introduce the missing outside authority. `part.pinout`
 * (carried into `HirConnector.pinout` by the compiler) is what the THING on
 * the other end of the connector fixes: a sensor's pin 3 is its analog output
 * whatever the harness calls it, and a board header's pin 1 is whatever the
 * board routed there. That claim comes from a datasheet, not from the file
 * being checked, so contradicting it is a real finding rather than a
 * restatement.
 *
 * ABSENCE MEANS NO CLAIM, and it is the overwhelmingly common case. A bare
 * housing has no pinout at all — pin 1 of a Micro-Fit receptacle is whatever
 * you crimp into it — so a part without `pinout` produces nothing here however
 * the harness is wired. A part with a PARTIAL pinout is treated the same way
 * pin by pin: a header that fixes pins 1-4 and leaves 5-8 as spares makes no
 * claim about 5-8, and this file makes none either. Silence is never read as
 * "no signal"; it is read as "the part does not say".
 *
 * NEITHER RULE EMITS A MARGIN, deliberately. A margin is only honest where the
 * underlying quantity is continuous and has a budget to divide by. A pin
 * either carries the signal the part fixes or it does not — there is no design
 * halfway between `CAN_H` and `VBAT_24V`, and no denominator anywhere in the
 * problem. Fraction-of-pins-matching would be the tempting invention and it is
 * exactly the wrong one: it hands an optimizer a slope up which a harness with
 * one catastrophically wrong pin out of forty scores 0.975 and looks nearly
 * perfect. Every rule in this pack that faced the same question — HK-ELEC-018,
 * 019, 020, HK-ELEC-022, 023 — omitted the margin for the same reason, and a
 * wrong slope is worse than no slope. So these rules measure nothing.
 *
 * PROVENANCE: `standard` is omitted, as it is on every rule in this pack that
 * cannot point at a document a reviewer could go and read. There is no
 * standard here to cite — the authority is the part's own datasheet, which is
 * per-part and already recorded on `provenance.datasheet`. Naming a standards
 * document would launder "the sensor vendor says so" into "ISO says so".
 */
import {
  DiagnosticSeverity,
  refs,
  rule,
  type Hir,
  type Rule
} from "@grayhaven/nerve"

const { Error: Err, Warning: Warn } = DiagnosticSeverity

/** Both rules are new in this release; bumped when a verdict can change. */
const RULE_VERSION = "1.0.0"

type HirConnector = Hir["connectors"][number]

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Numeric-aware, matching the compiler's pin ordering so pin "10" follows "2". */
const comparePins = (a: string, b: string): number => {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Pinout entries that are the part declining to name a signal rather than
 * naming one: a datasheet's `NC`, `N/C`, `NO CONNECT`, `RESERVED`, `DNC`, or a
 * bare dash. These are extremely common on real device pinouts and they are
 * not claims about what the pin carries — they are claims that nothing lands
 * there.
 *
 * The consequence is asymmetric on purpose. An unassigned no-connect pin is
 * CORRECT, so HK-CONN-024 stays silent; without this, every eight-pin sensor
 * with two spare cavities would emit two warnings for being wired exactly as
 * its datasheet says. But a no-connect pin the harness DOES assign is still a
 * contradiction and HK-CONN-023 still fires, because a wire crimped into a
 * cavity the device does not connect to is a signal that silently goes
 * nowhere.
 */
const NO_CONNECT = /^(N\.?\/?C\.?|NO[-_ ]?CONNECT|DNC|RESERVED|RSVD|-{1,2}|—)$/i

const isNoConnect = (signal: string): boolean => NO_CONNECT.test(signal.trim())

/**
 * How two signal names are compared: trimmed and case-folded, and NOTHING
 * else. `gnd` matches `GND`; `GND_SIG` does not match `GND`.
 *
 * Case and surrounding whitespace are forgiven because no two distinct nets in
 * this model are distinguished by them — every signal classifier in
 * `wire-data.ts` is already case-insensitive, so folding case here cannot
 * forgive a mismatch that any other rule would treat as real.
 *
 * Everything past that is deliberately strict, and the tempting looseness is
 * named here so the choice is reviewable rather than accidental:
 *
 * - `isGroundSignal` would make `AGND`, `PGND` and `CHASSIS_GND` all equal to
 *   `GND`. On a real device those are separate nets whose whole purpose is to
 *   be separate, and tying a sensor's analog ground to power ground at the
 *   connector is precisely the defect this rule exists to catch.
 * - `isPowerSignal` would make `5V` equal `24V`. That mismatch destroys the
 *   device.
 * - `differentialPartner` would make `CAN_H` equal `CAN_L`. A swapped
 *   differential pair is the single most common connector wiring error there
 *   is; forgiving it would leave this rule catching almost nothing worth
 *   catching.
 *
 * THE FAILURE MODE OF THIS CHOICE, stated plainly: a harness that legitimately
 * calls the part's `GND` net `GND_SIG`, or its `AOUT` net `SENSOR_OUT`, is
 * reported as a contradiction when nothing is physically wrong. That is a
 * naming disagreement between the design and the part, and the fix is to name
 * the net as the part names it or to waive HK-CONN-023 on that connector. The
 * cost is real, and it is the one worth paying: a synonym table that quietly
 * forgave a genuine `AGND`-for-`PGND` swap would make a passing run mean less
 * than no run at all, whereas a strict rule that occasionally asks about a
 * synonym is merely annoying.
 */
const normalizeSignal = (signal: string): string => signal.trim().toUpperCase()

interface PinoutEntry {
  /** Pin as the part names it. */
  readonly pin: string
  /** Signal the part fixes there, verbatim, for the message. */
  readonly declared: string
  /** Signal the design assigns, verbatim, or undefined when it assigns none. */
  readonly assigned: string | undefined
}

/**
 * A connector's pinout entries in pin order, each paired with what the design
 * actually assigned. Empty for a connector whose part declares no pinout,
 * which is the fast path and the common one.
 *
 * Pins are matched on the trimmed string, so a part keyed `"1"` meets a design
 * pin `"1"`. Nothing is inferred for a pinout key the connector has no pin
 * for: an unassigned pin and a pin the design never mentions are the same
 * thing here, since the compiler only emits pins the design assigned.
 */
const pinoutEntries = (c: HirConnector): ReadonlyArray<PinoutEntry> => {
  const declared = c.pinout
  if (declared === undefined) return []
  const assigned = new Map(c.pins.map((p) => [p.pin.trim(), p.signal]))
  return Object.entries(declared)
    .map(([pin, signal]) => ({
      pin: pin.trim(),
      declared: signal,
      assigned: assigned.get(pin.trim())
    }))
    .sort((a, b) => comparePins(a.pin, b.pin))
}

/** How the part is named in a message: MPN, and family when it adds anything. */
const partLabel = (c: HirConnector): string =>
  c.family !== undefined && c.family !== c.mpn ? `${c.family} ${c.mpn}` : c.mpn

// --- HK-CONN-023: assignment contradicts the part ---------------------------

/**
 * A pin is assigned a signal the part says it does not carry.
 *
 * This is an ERROR without qualification. The part is an outside authority: it
 * is the device on the far side of the connector, and it is not negotiating.
 * If a sensor's datasheet fixes pin 3 as the analog output and the harness
 * crimps `VBAT_24V` into pin 3, the harness is wrong — no routing change, no
 * revision, and no downstream rule makes it right, and the first time the
 * assembly is powered the sensor sees battery on an output. There is no
 * reading of this finding as a style preference, so there is no severity below
 * `error` that describes it honestly.
 *
 * A no-connect entry (see `NO_CONNECT`) counts, and the message says so: the
 * part declares that nothing lands on that pin, and a wire that lands there
 * terminates in a cavity connected to nothing inside the device.
 *
 * Scope, stated so the silence is not mistaken for a gap: a pin the part's
 * pinout does not mention is untouched. A partial pinout is a partial claim.
 */
export const pinoutSignalContradiction: Rule = rule(
  "pinoutSignalContradiction",
  (ctx) => {
    // Connectors in ref order, pins in pin order: the runner sorts diagnostics
    // anyway, but emitting in a fixed order keeps a partial run reproducible.
    for (const c of [...ctx.hir.connectors].sort((a, b) => cmp(a.ref, b.ref))) {
      for (const e of pinoutEntries(c)) {
        if (e.assigned === undefined) continue // HK-CONN-024 owns that finding
        if (normalizeSignal(e.assigned) === normalizeSignal(e.declared)) continue
        const noConnect = isNoConnect(e.declared)
        ctx.report({
          severity: Err,
          message: noConnect
            ? `Pin ${c.ref}.${e.pin} is assigned ${e.assigned}, but part ${partLabel(c)} declares pin ${e.pin} as no-connect (${e.declared}); a wire crimped there lands in a cavity the device does not connect to.`
            : `Pin ${c.ref}.${e.pin} is assigned ${e.assigned}, but part ${partLabel(c)} fixes pin ${e.pin} as ${e.declared}. The part's pinout is the authority here, not the harness.`,
          target: refs.pin(c.ref, e.pin),
          targets: [refs.connector(c.ref)],
          data: {
            mpn: c.mpn,
            pin: e.pin,
            partSignal: e.declared,
            assignedSignal: e.assigned
          }
        })
      }
    }
  },
  { code: "HK-CONN-023", ruleVersion: RULE_VERSION }
)

// --- HK-CONN-024: pin the part defines, left unassigned ---------------------

/**
 * The part fixes a signal on a pin and the design assigns none.
 *
 * A SEPARATE CODE from HK-CONN-023 on purpose. These are different defects
 * with different fixes: a device pin wired to the wrong thing is a wrong
 * connection and the fix is to move a wire, while a device pin left unwired is
 * a missing connection and the fix is to add one — or to confirm the feature
 * is genuinely unused. They also fail differently in the field (a wrong pin
 * damages or corrupts, a missing pin simply does nothing), and a team that
 * accepts one is not thereby accepting the other. One code could not be waived
 * for the second without also silencing the first, which is the concrete
 * reason they are two.
 *
 * WARNING, not error, and this is the more arguable of the two severities. The
 * part is an authority on what a pin IS; it is not an authority on whether
 * this harness must use it. Real designs legitimately leave device pins
 * unwired all the time — an unused digital output, the second ground on a
 * two-ground device, a diagnostic line brought out only on the test harness.
 * Erroring on those would make the common, correct case fail, and a rule that
 * fails correct designs gets switched off, taking HK-CONN-023 with it in
 * practice. But it is not `info` either, because this is also exactly how a
 * whole signal silently goes missing from a build: you meant to bring out the
 * sensor's `CAN_L` and simply did not, and nothing else in the pack notices,
 * since HK-CONN-010 only speaks about pins the design already assigned.
 * `warning` is the severity that means "confirm this is deliberate", and that
 * is precisely the question.
 *
 * No-connect entries are skipped — see `NO_CONNECT` for why an unassigned
 * no-connect pin is the correct design, not a finding.
 */
export const pinoutPinUnassigned: Rule = rule(
  "pinoutPinUnassigned",
  (ctx) => {
    // Same fixed emission order as HK-CONN-023: connectors by ref, pins by pin.
    for (const c of [...ctx.hir.connectors].sort((a, b) => cmp(a.ref, b.ref))) {
      for (const e of pinoutEntries(c)) {
        if (e.assigned !== undefined) continue
        if (isNoConnect(e.declared)) continue
        ctx.report({
          severity: Warn,
          message: `Part ${partLabel(c)} fixes pin ${e.pin} of ${c.ref} as ${e.declared}, but the design assigns nothing to it. Assign the signal, or confirm the pin is deliberately unused.`,
          target: refs.pin(c.ref, e.pin),
          targets: [refs.connector(c.ref)],
          data: { mpn: c.mpn, pin: e.pin, partSignal: e.declared }
        })
      }
    }
  },
  { code: "HK-CONN-024", ruleVersion: RULE_VERSION }
)

/** The two part-pinout contract rules, in code order. */
export const pinoutRules: ReadonlyArray<Rule> = [
  pinoutSignalContradiction,
  pinoutPinUnassigned
]
