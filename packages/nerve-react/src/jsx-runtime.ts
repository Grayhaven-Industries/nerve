/**
 * Custom JSX runtime (automatic mode): no React, no fiber, no VDOM —
 * `jsx(Component, props)` simply CALLS the component. JSX becomes pure
 * function application over the typed DSL, so authoring style changes
 * and nothing else does.
 */
export type JsxComponent<P, R> = (props: P) => R

export const jsx = <P, R>(type: JsxComponent<P, R>, props: P): R => type(props)
export const jsxs = jsx
export const jsxDEV = <P, R>(type: JsxComponent<P, R>, props: P): R => type(props)

export const Fragment = <C>(props: { children?: C }): C | undefined => props.children

// Minimal JSX namespace: components only (no intrinsic lowercase elements —
// <Harness> not <harness>, keeping every element a typed function).
declare global {
  namespace JSX {
    // Element is intentionally loose (each component returns its own def
    // type); ElementType constrains elements to component FUNCTIONS.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Element = any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ElementType = (props: any) => Element
    interface ElementChildrenAttribute {
      children: unknown
    }
    interface IntrinsicElements {
      [k: string]: never
    }
  }
}
