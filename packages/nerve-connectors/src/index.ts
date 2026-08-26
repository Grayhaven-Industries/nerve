export { MolexMicroFit } from "./molex-micro-fit.js"
export { MolexMegaFit } from "./molex-mega-fit.js"
export { AmassXT60 } from "./amass-xt60.js"
export { JstPH } from "./jst-ph.js"
export { JstXH } from "./jst-xh.js"
export { DeutschDT } from "./deutsch-dt.js"

import { staticProvider, type ConnectorPart } from "@grayhaven/nerve"
import { MolexMicroFit } from "./molex-micro-fit.js"
import { MolexMegaFit } from "./molex-mega-fit.js"
import { AmassXT60 } from "./amass-xt60.js"
import { JstPH } from "./jst-ph.js"
import { JstXH } from "./jst-xh.js"
import { DeutschDT } from "./deutsch-dt.js"

/** Every part in the bundled library, keyed by MPN. */
export const allParts = {
  ...MolexMicroFit,
  ...MolexMegaFit,
  ...AmassXT60,
  ...JstPH,
  ...JstXH,
  ...DeutschDT
} satisfies Readonly<Record<string, ConnectorPart>>

/** The bundled verified library as a PartProvider (PRD §42). */
export const nerveConnectorsProvider = staticProvider("nerve-connectors", allParts)
export {
  allTerminals,
  DeutschDTTerminals,
  JstPHTerminals,
  JstXHTerminals,
  MolexMicroFitTerminals
} from "./terminals.js"
export { part, partInfo, partSpecs, type PartInfo, type PartSpecName } from "./part-spec.js"
export {
  coverageTable,
  definePart,
  partCoverage,
  partCoverageDiagnostics,
  scaffoldPartSource,
  type PartCoverage
} from "./define.js"
