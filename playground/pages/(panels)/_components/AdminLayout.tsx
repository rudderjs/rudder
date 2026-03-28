import '@/index.css'
import { useState, useEffect } from 'react'
import { navigate } from 'vike/client/router'
import { Toaster } from 'sonner'
import type { PanelNavigationMeta } from '@boostkit/panels'
import { GlobalSearch } from './GlobalSearch.js'
import { useI18n } from '../_hooks/useI18n.js'
import { ResourceIcon } from './ResourceIcon.js'
import { ThemeProvider } from './ThemeProvider.js'
import { ThemeToggle } from './ThemeToggle.js'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar.js'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible.js'
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb.js'
import { TooltipProvider } from '@/components/ui/tooltip.js'
import { ChevronRightIcon, ChevronsUpDownIcon, LogOutIcon, BadgeCheckIcon, BellIcon } from 'lucide-react'
import { usePageContext } from 'vike-react/usePageContext'

// ─── Types ──────────────────────────────────────────────────

interface Props {
  panelMeta:    PanelNavigationMeta
  currentSlug?: string | undefined
  initialUser?: SessionUser | undefined
  children:     React.ReactNode
}

interface NavItem {
  slug:              string
  label:             string
  icon:              string | undefined
  href:              string
  kind:              'resource' | 'global' | 'page'
  navigationGroup?:  string | undefined
  navigationParent?: string | undefined
  children?:         NavItem[]
  badgeColor?:       string
}

interface SessionUser {
  name?:  string
  email?: string
  image?: string
}

// ─── Hooks ──────────────────────────────────────────────────

function buildNavItems(panelMeta: PanelNavigationMeta): NavItem[] {
  const path = panelMeta.path
  return [
    ...panelMeta.resources.map((r) => ({
      slug: r.slug, label: r.label, icon: r.icon,
      href: `${path}/resources/${r.slug}`,
      kind: 'resource' as const,
      navigationGroup: r.navigationGroup,
      badgeColor: r.navigationBadgeColor,
    })),
    ...(panelMeta.globals ?? []).map((g) => ({
      slug: g.slug, label: g.label, icon: g.icon,
      href: `${path}/globals/${g.slug}`,
      kind: 'global' as const,
    })),
    ...panelMeta.pages.map((p) => {
      const item: NavItem = {
        slug: p.slug, label: p.label, icon: p.icon,
        href: `${path}/${p.slug}`,
        kind: 'page' as const,
        navigationParent: (p as { navigationParent?: string }).navigationParent,
      }
      const children = (p as { children?: typeof panelMeta.pages }).children
      if (children && children.length > 0) {
        item.children = children.map(c => ({
          slug: c.slug, label: c.label, icon: c.icon,
          href: `${path}/${c.slug}`,
          kind: 'page' as const,
        }))
      }
      return item
    }),
  ]
}

function useNavItemsWithPersistedState(panelMeta: PanelNavigationMeta): NavItem[] {
  const base = buildNavItems(panelMeta)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return base
  const segment = panelMeta.path.replace(/^\//, '')
  return base.map((item) => {
    const resource = panelMeta.resources.find((r) => r.slug === item.slug)
    if (!resource?.rememberTable) return item
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return user
}

function useNavigationBadges(panelMeta: PanelNavigationMeta): Record<string, string | number | null> {
  const [badges, setBadges] = useState<Record<string, string | number | null>>({})
  useEffect(() => {
    fetch(`${panelMeta.path}/api/_badges`)
      .then(r => r.ok ? r.json() : {})
      .then(setBadges)
      .catch(() => {})
  }, [panelMeta.path])
  return badges
}

// ─── Small components ───────────────────────────────────────

const badgeColors: Record<string, string> = {
  gray:    'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  danger:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

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

// ─── SidebarLogo ────────────────────────────────────────────

function SidebarLogo({ branding, name, path }: { branding: PanelNavigationMeta['branding']; name: string; path: string }) {
  const title = branding?.title ?? name
  const isSvg = branding?.logo?.endsWith('.svg')
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={<a href={path} />}
          tooltip={title}
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            {branding?.logo ? (
              isSvg
                ? <SvgMask src={branding.logo} className="inline-block size-4" />
                : <img src={branding.logo} alt={title} className="size-4" />
            ) : (
              <span className="text-xs font-bold">{title.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="grid flex-1 text-start text-sm leading-tight">
            <span className="truncate font-semibold">{title}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// ─── NavUser ────────────────────────────────────────────────

function NavUser({ user, i18n }: { user: SessionUser | null; i18n: PanelNavigationMeta['i18n'] }) {
  const { isMobile } = useSidebar()
  if (!user) return null
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' })
    await navigate('/login')
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <Avatar className="h-8 w-8 rounded-lg">
              {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
              <AvatarFallback className="rounded-lg text-[10px]">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-start text-sm leading-tight">
              {user.name && <span className="truncate font-medium">{user.name}</span>}
              {user.email && <span className="truncate text-xs">{user.email}</span>}
            </div>
            <ChevronsUpDownIcon className="ms-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
                    <AvatarFallback className="rounded-lg text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-start text-sm leading-tight">
                    {user.name && <span className="truncate font-medium">{user.name}</span>}
                    {user.email && <span className="truncate text-xs">{user.email}</span>}
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <BadgeCheckIcon />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <BellIcon />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleSignOut}>
              <LogOutIcon />
              {i18n.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// ─── NavMain — collapsible groups with sub-items ────────────

function NavMain({ items, currentSlug, badges }: {
  items: NavItem[]
  currentSlug: string
  badges: Record<string, string | number | null>
}) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        const allChildren = item.children ?? []
        const badge = badges[item.slug]
        const colorCls = badgeColors[item.badgeColor ?? 'gray'] ?? badgeColors['gray']
        const isActive = item.slug === currentSlug
        const isChildActive = allChildren.some(c => c.slug === currentSlug)

        // Item with children → collapsible
        if (allChildren.length > 0) {
          return (
            <Collapsible
              key={item.slug}
              defaultOpen={isActive || isChildActive}
              className="group/collapsible"
              render={<SidebarMenuItem />}
            >
              <CollapsibleTrigger
                render={<SidebarMenuButton tooltip={item.label} isActive={isActive} />}
              >
                <ResourceIcon icon={item.icon} />
                <span>{item.label}</span>
                {badge != null && (
                  <span className={`ms-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colorCls}`}>
                    {badge}
                  </span>
                )}
                <ChevronRightIcon className="ms-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {allChildren.map(child => (
                    <SidebarMenuSubItem key={child.slug}>
                      <SidebarMenuSubButton render={<a href={child.href} />} isActive={child.slug === currentSlug}>
                        <span>{child.label}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          )
        }

        // Simple item
        return (
          <SidebarMenuItem key={item.slug}>
            <SidebarMenuButton
              render={<a href={item.href} />}
              isActive={isActive}
              tooltip={item.label}
            >
              <ResourceIcon icon={item.icon} />
              <span>{item.label}</span>
              {badge != null && (
                <span className={`ms-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colorCls}`}>
                  {badge}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

// ─── SidebarNavigation ──────────────────────────────────────

function SidebarNavigation({ items, currentSlug, badges }: {
  items: NavItem[]
  currentSlug: string
  badges: Record<string, string | number | null>
}) {
  const resourceItems = items.filter(i => i.kind === 'resource')
  const globalItems   = items.filter(i => i.kind === 'global')
  const pageItems     = items.filter(i => i.kind === 'page')

  // Group resources by navigationGroup
  const grouped = new Map<string, NavItem[]>()
  const ungrouped: NavItem[] = []
  for (const item of resourceItems) {
    if (item.navigationGroup) {
      const list = grouped.get(item.navigationGroup) ?? []
      list.push(item)
      grouped.set(item.navigationGroup, list)
    } else {
      ungrouped.push(item)
    }
  }

  // Merge visual children (navigationParent) into parent pages
  const topPages = pageItems.filter(p => !p.navigationParent)
  const visualChildren = pageItems.filter(p => !!p.navigationParent)
  const visualChildMap = new Map<string, NavItem[]>()
  for (const child of visualChildren) {
    const list = visualChildMap.get(child.navigationParent!) ?? []
    list.push(child)
    visualChildMap.set(child.navigationParent!, list)
  }
  const topPagesWithChildren = topPages.map(item => {
    const merged = [...(item.children ?? []), ...(visualChildMap.get(item.label) ?? [])]
    return merged.length > 0 ? { ...item, children: merged } : item
  })

  return (
    <>
      {ungrouped.length > 0 && (
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMain items={ungrouped} currentSlug={currentSlug} badges={badges} />
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {[...grouped.entries()].map(([label, groupItems]) => (
        <SidebarGroup key={label}>
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMain items={groupItems} currentSlug={currentSlug} badges={badges} />
          </SidebarGroupContent>
        </SidebarGroup>
      ))}

      {globalItems.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMain items={globalItems} currentSlug={currentSlug} badges={badges} />
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {topPagesWithChildren.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Pages</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMain items={topPagesWithChildren} currentSlug={currentSlug} badges={badges} />
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}

// ─── HeaderBreadcrumb ───────────────────────────────────────

interface Crumb { label: string; href?: string }

function HeaderBreadcrumb({ panelMeta, items, currentSlug, i18n }: {
  panelMeta: PanelNavigationMeta
  items: NavItem[]
  currentSlug: string
  i18n: ReturnType<typeof useI18n>
}) {
  const pageContext = usePageContext() as { urlPathname: string; data?: Record<string, unknown> }
  const path = panelMeta.path
  const pathname = pageContext.urlPathname
  const data = pageContext.data ?? {}
  const panelTitle = panelMeta.branding?.title ?? panelMeta.name

  // Build crumbs from URL structure
  const crumbs: Crumb[] = [{ label: panelTitle, href: path }]

  // Parse the URL after the panel path
  const rest = pathname.slice(path.length).replace(/^\//, '')
  const segments = rest ? rest.split('/') : []

  if (segments[0] === 'resources' && segments[1]) {
    const resourceSlug = segments[1]
    const navItem = items.find(i => i.slug === resourceSlug)
    const resourceLabel = (data.resourceMeta as Record<string, string> | undefined)?.label ?? navItem?.label ?? resourceSlug

    // Group label if available
    if (navItem?.navigationGroup) {
      crumbs.push({ label: navItem.navigationGroup })
    }

    // Resource list
    crumbs.push({ label: resourceLabel, href: `${path}/resources/${resourceSlug}` })

    if (segments[2] === 'create') {
      const singular = (data.resourceMeta as Record<string, string> | undefined)?.labelSingular ?? 'New'
      crumbs.push({ label: `New ${singular}` })
    } else if (segments[2]) {
      // Detail or edit — segments[2] is record ID
      const recordId = segments[2]
      // Try to get a display title from record data
      const record = data.record as Record<string, unknown> | undefined
      const recordTitle = record?.title ?? record?.name ?? record?.label ?? `#${recordId}`
      crumbs.push({ label: String(recordTitle), href: `${path}/resources/${resourceSlug}/${recordId}` })

      if (segments[3] === 'edit') {
        crumbs.push({ label: i18n.edit ?? 'Edit' })
      }
    }
  } else if (segments[0] === 'globals' && segments[1]) {
    const globalSlug = segments[1]
    const navItem = items.find(i => i.slug === globalSlug)
    crumbs.push({ label: 'Settings' })
    crumbs.push({ label: navItem?.label ?? globalSlug })
  } else if (segments[0] && segments[0] !== '') {
    // Custom page — may be nested (e.g. tables-demo/pagination)
    // The first segment is always the parent page slug
    const parentSlug = segments[0]
    const parentItem = items.find(i => i.slug === parentSlug)

    if (segments.length > 1) {
      // Sub-page: show parent as link, then child as current
      const fullSlug = segments.join('/')
      crumbs.push({ label: parentItem?.label ?? parentSlug, href: `${path}/${parentSlug}` })

      // Find child label from parent's children or from pageMeta
      const childItem = parentItem?.children?.find(c => c.slug === fullSlug)
      const childLabel = (data.pageMeta as Record<string, string> | undefined)?.label ?? childItem?.label ?? segments[segments.length - 1]!
      crumbs.push({ label: childLabel })
    } else {
      // Top-level page
      const pageLabel = (data.pageMeta as Record<string, string> | undefined)?.label ?? parentItem?.label ?? parentSlug
      crumbs.push({ label: pageLabel })
    }
  }

  // If only root crumb, show just the panel name as current page
  if (crumbs.length === 1) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{panelTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={i} className="contents">
              {i > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem className={i === 0 ? 'hidden md:block' : ''}>
                {isLast || !crumb.href
                  ? <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  : <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                }
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

// ─── SidebarLayout ──────────────────────────────────────────

function SidebarLayout({ panelMeta, currentSlug, initialUser, children }: Props & { currentSlug: string }) {
  const items  = useNavItemsWithPersistedState(panelMeta)
  const badges = useNavigationBadges(panelMeta)
  const user   = useSessionUser(initialUser)
  const i18n   = useI18n()
  const dir    = panelMeta.dir ?? 'ltr'
  const branding = panelMeta.branding

  return (
    <SidebarProvider>
      <Sidebar side={dir === 'rtl' ? 'right' : 'left'} collapsible="icon">
        <SidebarHeader>
          <SidebarLogo branding={branding} name={panelMeta.name} path={panelMeta.path} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarNavigation items={items} currentSlug={currentSlug} badges={badges} />
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={user} i18n={i18n} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <HeaderBreadcrumb panelMeta={panelMeta} items={items} currentSlug={currentSlug} i18n={i18n} />
          </div>
          <div className="ms-auto flex items-center gap-2 px-4">
            <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>

      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  )
}

// ─── TopbarLayout ───────────────────────────────────────────

function TopbarLayout({ panelMeta, currentSlug, initialUser, children }: Props & { currentSlug: string }) {
  const items = useNavItemsWithPersistedState(panelMeta)
  const user  = useSessionUser(initialUser)
  const i18n  = useI18n()
  const dir   = panelMeta.dir ?? 'ltr'
  const branding = panelMeta.branding

  function UserDropdown() {
    if (!user) return null
    const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()

    async function handleSignOut() {
      await fetch('/api/auth/sign-out', { method: 'POST' })
      await navigate('/login')
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
            <LogOutIcon />
            {i18n.signOut}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

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
        <UserDropdown />
      </header>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

// ─── AdminLayout (entry) ────────────────────────────────────

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
