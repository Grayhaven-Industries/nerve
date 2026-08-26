/**
 * WireViz two-letter color codes ↔ Nerve color names.
 */

const CODE_TO_NAME = {
  BK: "black",
  WH: "white",
  GY: "gray",
  PK: "pink",
  RD: "red",
  OG: "orange",
  YE: "yellow",
  OL: "olive",
  GN: "green",
  TQ: "turquoise",
  BU: "blue",
  VT: "violet",
  BN: "brown",
  BG: "beige",
  IV: "ivory",
  SL: "slate",
  CU: "copper",
  SN: "tin",
  SR: "silver",
  GD: "gold"
} as const

type WireVizColorCode = keyof typeof CODE_TO_NAME

const isWireVizColorCode = (code: string): code is WireVizColorCode =>
  Object.hasOwn(CODE_TO_NAME, code)

const NAME_TO_CODE = new Map<string, string>(
  Object.entries(CODE_TO_NAME).map(([code, name]) => [name, code])
)

export const colorFromWireViz = (code: string): string => {
  const upper = code.toUpperCase()
  return isWireVizColorCode(upper) ? CODE_TO_NAME[upper] : code
}

export const colorToWireViz = (name: string): string =>
  NAME_TO_CODE.get(name.toLowerCase()) ?? name.toUpperCase().slice(0, 2)

/** Wire color sequences for WireViz `color_code` generation. */
export const COLOR_CODES = {
  // DIN 47100 (first 10)
  DIN: ["WH", "BN", "GN", "YE", "GY", "PK", "BU", "RD", "BK", "VT"],
  // IEC 60757-flavored cycle used by WireViz
  IEC: ["BN", "RD", "OG", "YE", "GN", "BU", "VT", "GY", "WH", "BK"]
} as const satisfies Record<string, ReadonlyArray<string>>

export type WireVizColorCodeName = keyof typeof COLOR_CODES

export const isWireVizColorCodeName = (name: string): name is WireVizColorCodeName =>
  Object.hasOwn(COLOR_CODES, name)
