# @grayhaven/nerve-rules

## 8.0.0

### Patch Changes

- Updated dependencies [00c77ea]
  - @grayhaven/nerve@8.0.0

## 7.1.0

### Patch Changes

- @grayhaven/nerve@7.1.0

## 7.0.0

### Major Changes

- Findings carry margins, parts carry the data rules judge against, and routed branches are measured.

  **Breaking.** The API is additive — nothing was removed or renamed, every new
  schema field is optional and omitted when absent, and golden HIR is
  byte-identical for a design that adopts none of it. What breaks is verdicts.

  - The rule set goes from 43 to 53. A harness that passed on 6.2.0 can fail on
    7.0.0: `HK-ELEC-018` to `HK-ELEC-024` (CAN bus topology, ground loops, shield
    termination), `HK-MFG-012`/`013` (insulation against the contact barrel and
    the seal), `HK-CONN-023`/`024` (a pin contradicting the pinout its part fixes).
  - `nerve diff` now exits 1 when only margins moved. Anyone gating CI on its exit
    code will see failures where the structure is unchanged — which is the point,
    since a revision that quietly eats 30% of the thermal headroom previously
    reported "no differences".
  - `HK-MFG-004` and `HK-CONN-016` judge the fitted contact's own limits rather
    than the housing's when a terminal record exists, so a verdict can change on
    unchanged input. A housing family often spans a wider range than any contact
    in it.
  - `HK-ELEC-010` traverses splices downstream of a protection device instead of
    reading only the author's `protects` list, and `HK-WIRE-004` derates by the
    number of current-carrying conductors sharing a bundle.

  **Margins.** Rules now emit a continuous measurement on every evaluation, not
  only on failure. A wire at 99% of its derated ampacity and one at 40% both pass
  and are not the same design; `utilization = measured / limit` makes that
  visible, and `nerve review` prints the tightest headroom.

  **Part data.** `TerminalPart` and `SealPart` model the contact that actually
  crimps the wire, with the crimp process data an operator needs. `ConnectorPart`
  gains a `pinout`, which lets a device contradict a wiring claim that previously
  only ever agreed with itself. Nine terminals ship, none marked verified, and
  none carrying a crimp height — published values for a single gauge disagree
  across sources, and a wrong acceptance window silently passes bad crimps.

  **Geometry.** A branch can carry a routed centerline; the compiler measures it
  and `HK-BRANCH-004` reports a declared length contradicting it. Drawings unroll
  the route by arc length rather than foreshortening it.

  **Soundness.** `nerve provenance` reports what a clean report rests on — which
  parts a verdict depends on and what evidence stands behind each. On the bundled
  robot-platform example, which reports zero errors, six of eight parts supply a
  limit that has never been verified.

  Also: four errors corrected in the bundled connector library, all of them a
  housing range standing in for a contact range, all found by modelling the
  contacts.

### Patch Changes

- Updated dependencies
  - @grayhaven/nerve@7.0.0

## 6.2.0

### Minor Changes

- Terminal modeling lands end to end. Connectors now carry per-pin crimp terminal assignments through the DSL, the JSX layer, compile, the BOM, and every exporter, and the bundled examples specify real Molex terminals.

  Three new rules ship, bringing the catalog to 37 checks with regenerated rule docs. HK-CONN-021 requires a terminal on every wired cavity of a connector that declares removable contacts. HK-MFG-011 warns when a wire belongs to a cable but does not identify which conductor it uses. HK-ELEC-011 flags nets that reach fewer than two accessible connector pins, which makes continuity testing impossible.

  The scaffold starter now assigns a compatible crimp terminal to its PH-2 housing, so a fresh `nerve init` validates green and demonstrates terminal assignment from the first file.

  The WireViz importer preserves more of the format's compact authoring features: YAML anchors and merge keys including an external prepend or template file, named connector and cable instances such as `PLUG.J1`, ascending and descending pin ranges, pin labels plus wire label and unique color references, and explicit `mm`, `cm`, `m`, `in`, and `ft` lengths. Template definitions used only to create named instances are no longer emitted as physical parts.

### Patch Changes

- Updated dependencies
  - @grayhaven/nerve@6.2.0
