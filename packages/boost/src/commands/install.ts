import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Boost } from '../Boost.js'
import { parseFrontmatter } from '../frontmatter.js'
import { generateClaudeMd, type PackageEntry, type SkillSummary } from '../generators/claude-md.js'
import type { BoostAgent, SkillEntry } from '../agents/types.js'

// ─── Package Manager Detection ──────────────────────────

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npx' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  return 'npx'
}

function getMcpCommand(pm: 'pnpm' | 'yarn' | 'bun' | 'npx'): { command: string; args: string[] } {
  const cliPath = 'node_modules/@rudderjs/cli/src/index.ts'

  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', 'tsx', cliPath, 'boost:mcp'] }
    case 'yarn':
      return { command: 'yarn', args: ['tsx', cliPath, 'boost:mcp'] }
    case 'bun':
      return { command: 'bunx', args: ['tsx', cliPath, 'boost:mcp'] }
    default:
      return { command: 'npx', args: ['tsx', cliPath, 'boost:mcp'] }
  }
}

// ─── Package Scanning ───────────────────────────────────

function findRudderPackages(cwd: string): string[] {
  const pkgJsonPath = join(cwd, 'package.json')
  if (!existsSync(pkgJsonPath)) return []

  const raw = readFileSync(pkgJsonPath, 'utf-8')
  let pkg: PackageJson
  try {
    pkg = JSON.parse(raw) as PackageJson
  } catch {
    return []
  }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  return Object.keys(allDeps).filter((name) => name.startsWith('@rudderjs/'))
}

// ─── Guideline & Skill Collection ───────────────────────

interface PackageGuideline {
  packageName: string
  shortName: string
  content: string
}

function collectGuidelines(cwd: string, packages: string[]): PackageGuideline[] {
  const results: PackageGuideline[] = []

  for (const pkg of packages) {
    const guidelinePath = join(cwd, 'node_modules', pkg, 'boost', 'guidelines.md')
    if (existsSync(guidelinePath)) {
      results.push({
        packageName: pkg,
        shortName: pkg.replace('@rudderjs/', ''),
        content: readFileSync(guidelinePath, 'utf-8'),
      })
    }
  }

  return results
}

interface DiscoveredSkill {
  entry: SkillEntry
  summary: SkillSummary
}

function collectSkills(cwd: string, packages: string[]): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = []

  for (const pkg of packages) {
    const skillsDir = join(cwd, 'node_modules', pkg, 'boost', 'skills')
    if (!existsSync(skillsDir)) continue

    let entries
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(skillsDir, entry.name)
      const skillMd = join(skillDir, 'SKILL.md')
      if (!existsSync(skillMd)) continue

      const summary = parseSkillFrontmatter(skillMd, entry.name)
      results.push({
        entry: { skillName: entry.name, sourcePath: skillDir },
        summary,
      })
    }
  }

  return results
}

function parseSkillFrontmatter(filePath: string, fallbackName: string): SkillSummary {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return { name: fallbackName }
  }

  const { data } = parseFrontmatter(raw)
  return {
    name: (typeof data['name'] === 'string' ? data['name'] : fallbackName),
    description: typeof data['description'] === 'string' ? data['description'] : '',
    trigger: typeof data['trigger'] === 'string' ? data['trigger'] : '',
    skip: typeof data['skip'] === 'string' ? data['skip'] : '',
    appliesTo: Array.isArray(data['appliesTo']) ? (data['appliesTo'] as unknown[]).filter(v => typeof v === 'string') as string[] : [],
  }
}

function filterSkillsByAppliesTo(skills: DiscoveredSkill[], installedPackages: string[], includeAll: boolean): DiscoveredSkill[] {
  if (includeAll) return skills
  const installed = new Set(installedPackages)
  return skills.filter(s => {
    const ap = s.summary.appliesTo ?? []
    if (ap.length === 0) return true
    return ap.some(p => installed.has(p))
  })
}

// ─── Per-Package Guidelines (always written) ────────────

function writePerPackageGuidelines(cwd: string, guidelines: PackageGuideline[]): void {
  if (guidelines.length === 0) return

  const dir = join(cwd, '.ai', 'guidelines')
  mkdirSync(dir, { recursive: true })

  for (const g of guidelines) {
    const dest = join(dir, `${g.shortName}.md`)
    writeFileSync(dest, g.content, 'utf-8')
  }
  console.log(`  Wrote ${guidelines.length} per-package guideline(s) to .ai/guidelines/`)
}

// ─── Agent Selection ────────────────────────────────────

function hasFlag(args: string[] | undefined, flag: string): boolean {
  return !!args && args.includes(flag)
}

function parseAgentFlag(args?: string[]): string[] | null {
  if (!args) return null
  for (const arg of args) {
    if (arg.startsWith('--agent=')) {
      return arg.slice('--agent='.length).split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return null
}

function selectAgents(cwd: string, agentNames: string[] | null, allAgents: BoostAgent[]): BoostAgent[] {
  if (agentNames) {
    // Explicit selection via --agent flag
    const selected: BoostAgent[] = []
    for (const name of agentNames) {
      const agent = allAgents.find(a => a.name === name)
      if (agent) {
        selected.push(agent)
      } else {
        console.log(`  Warning: unknown agent "${name}". Available: ${allAgents.map(a => a.name).join(', ')}`)
      }
    }
    return selected
  }

  // Auto-detect: select agents whose config files exist
  const detected = allAgents.filter(a => a.detect(cwd))

  if (detected.length > 0) {
    console.log(`  Detected: ${detected.map(a => a.displayName).join(', ')}`)
    return detected
  }

  // Default to Claude Code if nothing detected
  const claudeCode = allAgents.find(a => a.name === 'claude-code')
  if (claudeCode) {
    console.log('  No agents detected — defaulting to Claude Code')
    return [claudeCode]
  }

  return []
}

// ─── Main Install ───────────────────────────────────────

export interface BoostInstallOptions {
  args?: string[]
}

export async function boostInstall(cwd: string, options?: BoostInstallOptions): Promise<void> {
  console.log('\nBoost: Installing IDE configs for AI coding assistants...\n')

  // 1. Scan packages
  const packages = findRudderPackages(cwd)
  if (packages.length === 0) {
    console.log('  No @rudderjs/* packages found in package.json.')
    return
  }
  console.log(`  Found ${packages.length} @rudderjs/* package(s): ${packages.join(', ')}\n`)

  // 2. Collect guidelines & skills (with frontmatter)
  const guidelines = collectGuidelines(cwd, packages)
  const guidelineMap = new Set(guidelines.map(g => g.packageName))
  const discoveredSkills = collectSkills(cwd, packages)

  const includeAll = hasFlag(options?.args, '--include-all-skills')
  const filteredSkills = filterSkillsByAppliesTo(discoveredSkills, packages, includeAll)

  // 3. Build new structured CLAUDE.md content
  const packageEntries: PackageEntry[] = packages.map(name => ({
    name,
    shortName: name.replace('@rudderjs/', ''),
    hasGuideline: guidelineMap.has(name),
  }))

  const guidelineContent = generateClaudeMd({
    cwd,
    packages: packageEntries,
    skills: filteredSkills.map(s => s.summary),
  })

  // 4. Select agents
  const allAgents = Boost.getAllAgents()
  const selectedAgents = selectAgents(cwd, parseAgentFlag(options?.args), allAgents)

  if (selectedAgents.length === 0) {
    console.log('  No agents selected.')
    return
  }

  console.log(`  Installing for: ${selectedAgents.map(a => a.displayName).join(', ')}\n`)

  // 5. Detect package manager for MCP command
  const pm = detectPackageManager(cwd)
  const mcpCommand = getMcpCommand(pm)

  // 6. Run each agent's install
  for (const agent of selectedAgents) {
    console.log(`  ${agent.displayName}:`)

    if (agent.supportsGuidelines) {
      await agent.installGuidelines(cwd, guidelineContent)
      console.log(`    ✓ Guidelines`)
    }

    if (agent.supportsMcp) {
      await agent.installMcp(cwd, mcpCommand)
      console.log(`    ✓ MCP config`)
    }

    if (agent.supportsSkills && agent.installSkills && filteredSkills.length > 0) {
      await agent.installSkills(cwd, filteredSkills.map(s => s.entry))
      console.log(`    ✓ ${filteredSkills.length} skill(s)`)
    }
  }

  // 7. Always write per-package guidelines to .ai/guidelines/
  writePerPackageGuidelines(cwd, guidelines)

  // 8. Write boost.json
  const config = {
    version: '0.0.1',
    agents: selectedAgents.map(a => a.name),
    packages,
    skills: filteredSkills.map(s => s.summary.name),
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(cwd, 'boost.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8')
  console.log('  Wrote boost.json')

  console.log('\nDone.\n')
}
