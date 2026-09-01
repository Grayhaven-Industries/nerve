export interface Tag {
  description?: string
  name: string
  value: string | undefined
}

export const tags: Tag[] = [
  {
    name: 'All',
    value: undefined,
  },
  {
    name: 'Documentation',
    description: 'Quickstart, concepts, and guides',
    value: '(index)',
  },
  {
    name: 'Reference',
    description: 'CLI, DSL, SDK, HIR, rules, and parts',
    value: 'reference',
  },
  {
    name: 'Changelog',
    description: 'Released versions and their changes',
    value: 'changelog',
  },
]
