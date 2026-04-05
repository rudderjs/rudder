import type { IconLibrary } from './types.js'

/**
 * Canonical icon name → library-specific component name mapping.
 * Covers all icons used internally by the panels UI.
 */
export const iconMap: Record<string, Record<IconLibrary, string>> = {
  'chevron-right':     { lucide: 'ChevronRight',     tabler: 'IconChevronRight',    phosphor: 'CaretRight',        remix: 'RiArrowRightSLine' },
  'chevrons-up-down':  { lucide: 'ChevronsUpDown',   tabler: 'IconSelector',        phosphor: 'CaretUpDown',       remix: 'RiExpandUpDownLine' },
  'log-out':           { lucide: 'LogOut',            tabler: 'IconLogout',          phosphor: 'SignOut',           remix: 'RiLogoutBoxRLine' },
  'badge-check':       { lucide: 'BadgeCheck',        tabler: 'IconRosetteDiscountCheck', phosphor: 'SealCheck',   remix: 'RiVerifiedBadgeFill' },
  'bell':              { lucide: 'Bell',              tabler: 'IconBell',            phosphor: 'Bell',              remix: 'RiNotification3Line' },
  'x':                 { lucide: 'X',                 tabler: 'IconX',               phosphor: 'X',                 remix: 'RiCloseLine' },
  'plus':              { lucide: 'Plus',              tabler: 'IconPlus',            phosphor: 'Plus',              remix: 'RiAddLine' },
  'arrow-up':          { lucide: 'ArrowUp',           tabler: 'IconArrowUp',         phosphor: 'ArrowUp',           remix: 'RiArrowUpLine' },
  'sparkles':          { lucide: 'Sparkles',          tabler: 'IconSparkles',        phosphor: 'Sparkle',           remix: 'RiMagicLine' },
  'check':             { lucide: 'Check',             tabler: 'IconCheck',           phosphor: 'Check',             remix: 'RiCheckLine' },
  'chevron-down':      { lucide: 'ChevronDown',       tabler: 'IconChevronDown',     phosphor: 'CaretDown',         remix: 'RiArrowDownSLine' },
  'trash':             { lucide: 'Trash2',            tabler: 'IconTrash',           phosphor: 'Trash',             remix: 'RiDeleteBinLine' },
  'message-square':    { lucide: 'MessageSquare',     tabler: 'IconMessage',         phosphor: 'ChatCircle',        remix: 'RiChat1Line' },
  'type':              { lucide: 'Type',              tabler: 'IconTypography',      phosphor: 'TextT',             remix: 'RiFontSize' },
  'panel-left':        { lucide: 'PanelLeft',         tabler: 'IconLayoutSidebar',   phosphor: 'SidebarSimple',     remix: 'RiLayoutLeftLine' },
  'grip-vertical':     { lucide: 'GripVertical',      tabler: 'IconGripVertical',    phosphor: 'DotsSixVertical',   remix: 'RiDraggable' },
  'search':            { lucide: 'Search',            tabler: 'IconSearch',          phosphor: 'MagnifyingGlass',   remix: 'RiSearchLine' },
  'settings':          { lucide: 'Settings',          tabler: 'IconSettings',        phosphor: 'Gear',              remix: 'RiSettings3Line' },
  'file-text':         { lucide: 'FileText',          tabler: 'IconFileText',        phosphor: 'FileText',          remix: 'RiFileTextLine' },
  'users':             { lucide: 'Users',             tabler: 'IconUsers',           phosphor: 'Users',             remix: 'RiGroupLine' },
  'folder':            { lucide: 'Folder',            tabler: 'IconFolder',          phosphor: 'Folder',            remix: 'RiFolderLine' },
  'sun':               { lucide: 'Sun',               tabler: 'IconSun',             phosphor: 'Sun',               remix: 'RiSunLine' },
  'moon':              { lucide: 'Moon',              tabler: 'IconMoon',            phosphor: 'Moon',              remix: 'RiMoonLine' },
  'palette':           { lucide: 'Palette',           tabler: 'IconPalette',         phosphor: 'Palette',           remix: 'RiPaletteLine' },
  'copy':              { lucide: 'Copy',              tabler: 'IconCopy',            phosphor: 'Copy',              remix: 'RiFileCopyLine' },
  'check-circle':      { lucide: 'CheckCircle',       tabler: 'IconCircleCheck',     phosphor: 'CheckCircle',       remix: 'RiCheckboxCircleLine' },
  'bar-chart':         { lucide: 'BarChart3',         tabler: 'IconChartBar',        phosphor: 'ChartBar',          remix: 'RiBarChartLine' },
  'link':              { lucide: 'Link',              tabler: 'IconLink',            phosphor: 'Link',              remix: 'RiLinkM' },
  'folder-open':       { lucide: 'FolderOpen',        tabler: 'IconFolderOpen',      phosphor: 'FolderOpen',        remix: 'RiFolderOpenLine' },
}

/** Get the library-specific icon name for a canonical name. */
export function resolveIconName(canonical: string, library: IconLibrary): string {
  return iconMap[canonical]?.[library] ?? iconMap[canonical]?.lucide ?? canonical
}
