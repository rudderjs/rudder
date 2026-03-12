import '@/index.css'
import { useState, useEffect } from 'react'
import { Toaster } from 'sonner'
import type { PanelMeta } from '@boostkit/panels'
import { GlobalSearch } from './GlobalSearch.js'
import { ResourceIcon } from './ResourceIcon.js'
import { ThemeProvider } from './ThemeProvider.js'
import { ThemeToggle } from './ThemeToggle.js'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.js'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.js'
import { Separator } from '@/components/ui/separator.js'
import {
  TooltipProvider,
} from '@/components/ui/tooltip.js'

interface Props {
  panelMeta:    PanelMeta
  currentSlug?: string
  initialUser?: SessionUser
  children:     React.ReactNode
}

interface NavItem {
  slug:  string
  label: string
  icon:  string | undefined
  href:  string
}

interface SessionUser {
  name?:  string
  email?: string
  image?: string
}

function buildNavItems(panelMeta: PanelMeta): NavItem[] {
  const path = panelMeta.path
  return [
    ...panelMeta.resources.map((r) => ({ slug: r.slug, label: r.label, icon: r.icon, href: `${path}/${r.slug}` })),
    ...panelMeta.pages.map((p)     => ({ slug: p.slug, label: p.label, icon: p.icon, href: `${path}/${p.slug}` })),
  ]
}

function useNavItemsWithPersistedState(panelMeta: PanelMeta): NavItem[] {
  const base = buildNavItems(panelMeta)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return base
  const segment = panelMeta.path.replace(/^\//, '')
  return base.map((item) => {
    const resource = panelMeta.resources.find((r) => r.slug === item.slug)
    if (!resource?.persistTableState) return item
    const saved = sessionStorage.getItem(`panels:${segment}:${item.slug}:tableState`)
    return saved ? { ...item, href: item.href + saved } : item
  })
}

function useSessionUser(initial?: SessionUser): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(initial ?? null)
  useEffect(() => {
    if (initial !== undefined) return
    fetch('/api/auth/get-session')
      .then(r => r.ok ? r.json() : null)
      .then((data: { user?: SessionUser } | null) => { if (data?.user) setUser(data.user) })
      .catch(() => {})
  }, [])
  return user
}

function UserDropdown({ user, i18n }: { user: SessionUser | null; i18n: PanelMeta['i18n'] }) {
  if (!user) return null
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors outline-none">
        <Avatar className="h-6 w-6 text-[10px]">
          {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        <span className="hidden sm:inline text-sm">{user.name ?? user.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              {user.name && <p className="text-sm font-medium">{user.name}</p>}
              {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleSignOut}>
          {i18n.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Sidebar user menu — collapses to just the avatar when sidebar is in icon mode. */
function SidebarUserMenu({ user, i18n }: { user: SessionUser | null; i18n: PanelMeta['i18n'] }) {
  if (!user) return null
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <SidebarMenuButton
            size="lg"
            render={<DropdownMenuTrigger />}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            tooltip={user.name ?? user.email ?? ''}
          >
            <Avatar className="h-7 w-7 rounded-md text-[10px]">
              {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
              <AvatarFallback className="rounded-md text-[10px]">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              {user.name && <span className="truncate font-medium">{user.name}</span>}
              {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
            </div>
          </SidebarMenuButton>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-[--radix-dropdown-menu-trigger-width] min-w-52 rounded-lg"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-1">
                  {user.name && <p className="text-sm font-medium">{user.name}</p>}
                  {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleSignOut}>
              {i18n.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** SVG rendered via CSS mask so currentColor applies without fetching. */
function SvgMask({ src, className }: { src: string; className?: string }) {
  return (
    <span
      className={className}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url(${src})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage: `url(${src})`,
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}

/** Logo that shows full branding when expanded, just the icon when collapsed. */
function SidebarLogo({ branding, name }: { branding: PanelMeta['branding']; name: string }) {
  const title = branding?.title ?? name
  const isSvg = branding?.logo?.endsWith('.svg')
  return (
    <div className="flex items-center gap-2 px-2 py-1 min-h-[2rem]">
      {branding?.logo ? (
        <>
          {isSvg
            ? <SvgMask src={branding.logo!} className="inline-block h-6 w-6 shrink-0" />
            : <img src={branding.logo} alt={title} className="h-6 w-6 shrink-0" />
          }
          <span className="text-sm font-semibold truncate group-data-[collapsible=icon]:hidden">{title}</span>
        </>
      ) : (
        <span className="text-sm font-semibold truncate">{title}</span>
      )}
    </div>
  )
}

function SidebarLayout({ panelMeta, currentSlug, initialUser, children }: Props & { currentSlug: string }) {
  const items = useNavItemsWithPersistedState(panelMeta)
  const user  = useSessionUser(initialUser)
  const i18n  = panelMeta.i18n
  const dir   = panelMeta.dir ?? 'ltr'
  const branding = panelMeta.branding

  return (
    <SidebarProvider>
      <div dir={dir} className="flex h-screen w-full">
        <Sidebar side={dir === 'rtl' ? 'right' : 'left'} collapsible="icon">
          <SidebarHeader className="border-b">
            <SidebarLogo branding={branding} name={panelMeta.name} />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.slug}>
                      <SidebarMenuButton render={<a href={item.href} />} isActive={item.slug === currentSlug} tooltip={item.label}>
                        <ResourceIcon icon={item.icon} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t">
            <SidebarUserMenu user={user} i18n={i18n} />
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 shrink-0 border-b flex items-center gap-2 px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground flex-1">
              {items.find(i => i.slug === currentSlug)?.label ?? ''}
            </span>
            <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  )
}

function TopbarLayout({ panelMeta, currentSlug, initialUser, children }: Props & { currentSlug: string }) {
  const items = useNavItemsWithPersistedState(panelMeta)
  const user  = useSessionUser(initialUser)
  const i18n  = panelMeta.i18n
  const dir   = panelMeta.dir ?? 'ltr'
  const branding = panelMeta.branding

  return (
    <div dir={dir} className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="h-14 shrink-0 border-b bg-card flex items-center gap-4 px-6">
        <div className="flex items-center gap-2 me-2">
          {branding?.logo
            ? <>
                {branding.logo.endsWith('.svg')
                  ? <SvgMask src={branding.logo} className="inline-block h-6 w-6" />
                  : <img src={branding.logo} alt={branding?.title ?? panelMeta.name} className="h-6 w-6" />
                }
                <span className="text-sm font-semibold">{branding?.title ?? panelMeta.name}</span>
              </>
            : <span className="text-sm font-semibold">{branding?.title ?? panelMeta.name}</span>
          }
        </div>
        <Separator orientation="vertical" className="h-4" />
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {items.map((item) => (
            <a
              key={item.slug}
              href={item.href}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
                item.slug === currentSlug
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              <ResourceIcon icon={item.icon} />
              {item.label}
            </a>
          ))}
        </nav>
        <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
        <ThemeToggle />
        <UserDropdown user={user} i18n={i18n} />
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

export function AdminLayout({ panelMeta, currentSlug, initialUser, children }: Props) {
  const slug = currentSlug ?? ''
  const content = panelMeta.layout === 'topbar'
    ? <TopbarLayout panelMeta={panelMeta} currentSlug={slug} initialUser={initialUser}>{children}</TopbarLayout>
    : <SidebarLayout panelMeta={panelMeta} currentSlug={slug} initialUser={initialUser}>{children}</SidebarLayout>

  return (
    <TooltipProvider>
      <ThemeProvider>
        {content}
      </ThemeProvider>
    </TooltipProvider>
  )
}
