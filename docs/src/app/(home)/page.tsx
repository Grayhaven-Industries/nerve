import {
  BookOpenIcon,
  type LucideIcon,
  RocketIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import type { LinkProps } from 'next/link'
import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export default function HomePage(): ReactElement {
  return (
    <main className='mx-auto flex w-full max-w-[1400px] flex-col px-4 py-16'>
      <h1 className='font-heading font-semibold text-2xl md:text-3xl'>
        Grayhaven Nerve documentation
      </h1>
      <p className='mt-1 max-w-2xl text-fd-muted-foreground text-lg'>
        Nerve turns structured harness data into a versioned representation,
        stable <code>HK-*</code> findings, and byte-reproducible manufacturing
        artifacts. Start with the quickstart, then keep the reference open.
      </p>

      <div className='mt-8 grid grid-cols-1 gap-4 text-left md:grid-cols-2'>
        <Tile
          description='Install the CLI and review a harness end to end in about five minutes.'
          href='/docs/quickstart'
          icon={{ icon: RocketIcon, id: '(index)' }}
          title='Quickstart'
        />
        <Tile
          description='How a design becomes HIR, what the rules judge it against, and what a report does not claim.'
          href='/docs'
          icon={{ icon: BookOpenIcon, id: '(index)' }}
          title='Concepts and guides'
        />
        <Tile
          description='Every command, flag, exit code, and the artifacts each one writes.'
          href='/docs/reference/cli'
          icon={{ icon: TerminalIcon, id: 'reference' }}
          title='CLI reference'
        />
        <Tile
          description='The built-in HK-* rules, the HIR schema, the DSL, and the bundled part library.'
          href='/docs/reference'
          icon={{ icon: WrenchIcon, id: 'reference' }}
          title='Reference'
        />
      </div>
    </main>
  )
}

function Tile({
  title,
  description,
  icon: { icon: ItemIcon, id },
  href,
}: {
  title: string
  description: string
  icon: {
    icon: LucideIcon
    id: string
  }
  href: string
}): ReactElement {
  return (
    <Item href={href}>
      <Icon className={id}>
        <ItemIcon className='size-full' />
      </Icon>
      <h2 className='mb-2 font-heading font-semibold text-lg'>{title}</h2>
      <p className='text-fd-muted-foreground text-sm'>{description}</p>
    </Item>
  )
}

function Icon({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <div
      className={cn(
        'mb-2 size-9 rounded-lg border p-1.5 shadow-fd-primary/30',
        className
      )}
      style={{
        boxShadow: 'inset 0px 8px 8px 0px var(--tw-shadow-color)',
      }}
    >
      {children}
    </div>
  )
}

function Item(
  props: LinkProps & { className?: string; children: ReactNode }
): ReactElement {
  const { className, children, ...rest } = props
  return (
    <Link
      {...rest}
      className={cn(
        'rounded-2xl border border-border bg-fd-accent/30 p-6 shadow-lg backdrop-blur-lg transition-all hover:bg-fd-accent',
        className
      )}
    >
      {children}
    </Link>
  )
}
