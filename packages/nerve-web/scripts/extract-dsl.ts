/**
 * DSL surface extraction: builder signatures and prop interfaces straight
 * from @grayhaven/nerve source via the TypeScript compiler API. Everything
 * docs/copilot/completions say about the DSL derives from THIS — prop
 * tables cannot drift from the code (dsl.md once documented three props
 * that never existed).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

export interface PropMeta {
  readonly name: string
  readonly type: string
  readonly optional: boolean
  readonly doc: string
}

export interface InterfaceMeta {
  readonly name: string
  readonly props: ReadonlyArray<PropMeta>
}

export interface BuilderMeta {
  readonly name: string
  readonly signature: string
  readonly doc: string
}

export interface DslMeta {
  readonly builders: ReadonlyArray<BuilderMeta>
  readonly interfaces: ReadonlyArray<InterfaceMeta>
}

// import.meta.dirname works under both bun (gen-llms) and node (vitest).
const NERVE_SRC = join(import.meta.dirname, "../../nerve/src")

/** Builders documented in the DSL reference, in presentation order. */
const BUILDERS: ReadonlyArray<{ file: string; names: ReadonlyArray<string> }> = [
  { file: "dsl.ts", names: ["harness", "connector", "wire", "splice", "cable", "branch", "label", "protection"] },
  { file: "variant.ts", names: ["variant"] },
  { file: "rules.ts", names: ["rule"] },
  { file: "config.ts", names: ["defineConfig"] }
]

/** Prop interfaces shown as tables, in presentation order. */
const INTERFACES: ReadonlyArray<{ file: string; names: ReadonlyArray<string> }> = [
  {
    file: "domain.ts",
    names: [
      "HarnessProps",
      "ConnectorPart"
    ]
  },
  { file: "dsl.ts", names: ["ConnectorProps"] },
  {
    file: "domain.ts",
    names: [
      "PinElectrical",
      "WireProps",
      "SpliceProps",
      "CableProps",
      "BranchProps",
      "LabelProps",
      "ProtectionProps"
    ]
  }
]

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)

/** A JSDoc comment is plain text or, when it holds {@link} tags, a node list. */
const isCommentNodes = (
  comment: string | ts.NodeArray<ts.JSDocComment>
): comment is ts.NodeArray<ts.JSDocComment> => Array.isArray(comment)

const docOf = (node: ts.Node): string => {
  const jsDocs = ts.getJSDocCommentsAndTags(node)
  for (const d of jsDocs) {
    if (ts.isJSDoc(d) && d.comment !== undefined) {
      return isCommentNodes(d.comment) ? d.comment.map((c) => c.text).join("") : d.comment
    }
  }
  return ""
}

/** Single-line rendering of a type/params source span. Newlines inside
 * object literals become `; ` separators (TS allows newline as a member
 * separator), BUT a newline that follows a separator already present in
 * the syntax (`,`, `|`, `&`, `{`, `(`, `<`) or precedes one (`|`, `&`,
 * `)`, `}`, `>`) must collapse to a space, or a wrapped union
 * (`| "a"\n| "b"`) / trailing comma would gain a spurious `;`. Line and
 * block comments are stripped first (they'd swallow the rest of the
 * single line otherwise). */
const flat = (text: string): string =>
  text
    .replace(/\/\/[^\n]*/g, "") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    // newline that is structurally already separated → just whitespace
    .replace(/([,{(<|&])\s*\n\s*/g, "$1 ")
    .replace(/\s*\n\s*([|&)}\]>])/g, " $1")
    // remaining newlines separate object members → explicit `;`
    .replace(/\s*\n\s*/g, "; ")
    .replace(/\{;\s*/g, "{ ")
    .replace(/;\s*\}/g, " }")
    .replace(/\s+/g, " ")
    .trim()

const extractInterfaces = (): Array<InterfaceMeta> => {
  const out: Array<InterfaceMeta> = []
  for (const { file, names } of INTERFACES) {
    const src = parse(join(NERVE_SRC, file))
    src.forEachChild((node) => {
      if (!ts.isInterfaceDeclaration(node) || !names.includes(node.name.text)) return
      const props = node.members.filter(ts.isPropertySignature).map((m) => ({
        name: ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : flat(m.name.getText(src)),
        type: m.type !== undefined ? flat(m.type.getText(src)) : "unknown",
        optional: m.questionToken !== undefined,
        doc: docOf(m)
      }))
      out.push({ name: node.name.text, props })
    })
  }
  // Presentation order, not file order.
  const order = INTERFACES.flatMap((i) => i.names)
  return out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
}

const extractBuilders = (): Array<BuilderMeta> => {
  const out: Array<BuilderMeta> = []
  for (const { file, names } of BUILDERS) {
    const src = parse(join(NERVE_SRC, file))
    src.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) return
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !names.includes(decl.name.text)) continue
        const init = decl.initializer
        if (init === undefined || !ts.isArrowFunction(init)) continue
        const params = init.parameters.map((p) => flat(p.getText(src))).join(", ")
        out.push({
          name: decl.name.text,
          signature: `${decl.name.text}(${params})`,
          doc: docOf(node)
        })
      }
    })
  }
  const order = BUILDERS.flatMap((b) => b.names)
  return out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
}

/** The generated reference block injected into docs-content/dsl.md. */
export const dslReferenceMd = (meta: DslMeta): string => {
  const sigs = meta.builders.map((b) => `${b.signature}`).join("\n")
  const tables = meta.interfaces
    .map((i) => {
      const rows = i.props
        .map(
          (p) =>
            `| \`${p.name}\` | \`${p.type.replace(/\|/g, "\\|")}\` | ${p.optional ? "no" : "yes"} | ${p.doc.replace(/\n/g, " ").replace(/\|/g, "\\|")} |`
        )
        .join("\n")
      return `### ${i.name}\n\n| Prop | Type | Required | Notes |\n| --- | --- | --- | --- |\n${rows}`
    })
    .join("\n\n")
  return `## Reference (generated from source)

This section is extracted from \`@grayhaven/nerve\` at build time; it cannot drift from the code.

\`\`\`ts
${sigs}
\`\`\`

${tables}
`
}

export const extractDslMeta = (): DslMeta => {
  const meta = { builders: extractBuilders(), interfaces: extractInterfaces() }
  // Extraction is structural: silently missing a renamed builder would
  // quietly un-document it. Fail loudly instead.
  const wantB = BUILDERS.flatMap((b) => b.names)
  const wantI = INTERFACES.flatMap((i) => i.names)
  const gotB = new Set(meta.builders.map((b) => b.name))
  const gotI = new Set(meta.interfaces.map((i) => i.name))
  const missing = [...wantB.filter((n) => !gotB.has(n)), ...wantI.filter((n) => !gotI.has(n))]
  if (missing.length > 0) {
    throw new Error(`extract-dsl: missing from @grayhaven/nerve source: ${missing.join(", ")}`)
  }
  return meta
}
