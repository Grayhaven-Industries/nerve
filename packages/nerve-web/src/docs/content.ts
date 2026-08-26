/** All prose docs pages, loaded with one glob (auto-includes new pages). */
const modules = import.meta.glob<string>("../../docs-content/*.md", {
  query: "?raw",
  eager: true,
  import: "default"
})

export const docsContent = (slug: string): string =>
  modules[`../../docs-content/${slug}.md`] ?? ""
