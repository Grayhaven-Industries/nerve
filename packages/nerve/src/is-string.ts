import { Schema } from "effect"

/** Runtime string check that narrows without a `typeof` probe. */
export const isString = Schema.is(Schema.String)
