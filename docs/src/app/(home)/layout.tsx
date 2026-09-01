import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { baseOptions, linkItems } from '@/lib/layout.shared'

export default function Layout({ children }: LayoutProps<'/'>) {
  const base = baseOptions()

  return (
    <HomeLayout
      {...base}
      links={linkItems}
      style={
        {
          '--spacing-fd-container': '1300px',
        } as object
      }
    >
      {children}
      <Footer />
    </HomeLayout>
  )
}

function Footer() {
  return (
    <footer className='mt-auto border-t bg-fd-card p-4 text-fd-secondary-foreground'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <p className='mb-1 font-heading font-semibold text-sm'>
            Grayhaven Nerve
          </p>
          <p className='text-xs'>
            A Nerve report records the checks that ran against the facts the
            design supplied. It is not a certification.
          </p>
        </div>
      </div>
    </footer>
  )
}
