/**
 * Project configuration (PRD §10.5).
 *
 * Lives in `nerve.config.ts` at the project root:
 *
 * ```ts
 * import { defineConfig } from "@grayhaven/nerve"
 * export default defineConfig({
 *   units: "mm",
 *   outputDir: "dist",
 *   rules: { missingWireColor: "error", missingWireLength: "warning" },
 *   exports: { csv: true, svg: true }
 * })
 * ```
 */
import type { Units } from "./domain.js"
import type { RuleConfig } from "./rules.js"
import type { PriceBreak, SupplyApproval } from "./supply.js"

/** Lifecycle risk per PRD §29 supplier/lifecycle fields. */
export type PartLifecycle = "active" | "nrnd" | "obsolete"

export interface PartCost {
  readonly unitCost: number
  readonly supplier?: string
  readonly leadTimeDays?: number
  readonly lifecycle?: PartLifecycle
  /** Exact source and retrieval time for reproducible legacy cost entries. */
  readonly source?: string
  readonly retrievedAt?: string
  readonly approval?: SupplyApproval
  readonly availableQuantity?: number
  readonly minimumOrderQuantity?: number
  readonly priceBreaks?: ReadonlyArray<PriceBreak>
}

/**
 * Cost and quote model (PRD §29). Prices are organization data, not design
 * data — they live in config (or a future part-data provider, §42), never
 * in the HIR.
 */
export interface CostModel {
  readonly currency?: string
  readonly laborRatePerHour: number
  /** Fraction of material lost to scrap, e.g. 0.05. */
  readonly scrapFactor?: number
  /** First-pass yield, e.g. 0.97 — per-unit cost divides by this. */
  readonly yield?: number
  /** Days at/above which a part is flagged long-lead. Default 60. */
  readonly longLeadThresholdDays?: number
  /** Part costs by MPN (connectors, terminals, seals, splice parts...). */
  readonly parts?: Readonly<Record<string, PartCost>>
  /** Wire cost per meter by gauge, e.g. { "18AWG": 0.22 }. */
  readonly wireCostPerMeter?: Readonly<Record<string, number>>
  readonly defaultWireCostPerMeter?: number
  readonly sleeveCostPerMeter?: number
  readonly labelUnitCost?: number
  readonly spliceUnitCost?: number
  /** Fallback for parts with no entry; also flags the line as unpriced. */
  readonly defaultPartCost?: number
}

/**
 * Manufacturing capability profile (PRD §38 adjacent): what THIS shop can
 * build. Capability is organization data like prices — it lives in config,
 * never in the HIR. Rules fall back to the conservative built-in tables
 * for anything a profile doesn't override.
 */
export interface ShopProfile {
  /** Max continuous current (A) per AWG — overrides the bundled table. */
  readonly ampacityByAwg?: Readonly<Record<number, number>>
  /** Typical insulated OD (mm) per AWG — overrides the bundled table. */
  readonly insulatedOdMmByAwg?: Readonly<Record<number, number>>
  /** Sleeve inner capacity (mm) by exact sleeve name — beats the
   * name-derived capacity ("braided-pet-12" → 12). */
  readonly sleeveCapacityMm?: Readonly<Record<string, number>>
  /** Bundle packing factor (default 1.155, practical hex pack). */
  readonly bundlePackingFactor?: number
  /** Minimum bend radius (mm) applied when a branch declares none. */
  readonly defaultMinBendRadiusMm?: number
}

export interface NerveConfig {
  readonly units?: Units
  readonly defaultWireTolerance?: number
  readonly outputDir?: string
  /**
   * Default harness entrypoint, relative to this config file — lets
   * `nerve compile` (and friends) run with no file argument.
   */
  readonly entry?: string
  /** All harness files in a multi-harness repo (watch/snapshot targets). */
  readonly harnessFiles?: ReadonlyArray<string>
  readonly rules?: RuleConfig
  readonly costing?: CostModel
  /** Shop manufacturing capabilities; parameterizes the HK-MFG rules. */
  readonly shop?: ShopProfile
  /** Plugin module paths (relative to the harness file) — rule packs etc. (PRD §40). */
  readonly plugins?: ReadonlyArray<string>
  readonly exports?: {
    readonly csv?: boolean
    readonly svg?: boolean
    readonly pdf?: boolean
  }
}

export const defineConfig = (config: NerveConfig): NerveConfig => config
