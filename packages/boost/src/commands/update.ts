import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { Boost } from '../Boost.js'
import { parseFrontmatter } from '../frontmatter.js'
import { generateClaudeMd, type PackageEntry, type SkillSummary } from '../generators/claude-md.js'
import type { SkillEntry } from '../agents/types.js'

interface BoostConfig {
  version: string
  agents?: string[]
  packages: string[]
  skills?: string[]
  generatedAt: string
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function scanInstalledPackages(cwd: string): string[] {
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

function readBoostJson(cwd: string): BoostConfig | undefined {
  const filePath = join(cwd, 'boost.json')
  if (!existsSync(filePath)) return undefined

  const raw = readFileSync(filePath, 'utf-8')
  try {
    return JSON.parse(raw) as BoostConfig
  } catch {
    return undefined
  }
}

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
    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMd = join(skillsDir, entry.name, 'SKILL.md')
          if (existsSync(skillMd)) {
            results.push({
              entry: { skillName: entry.name, sourcePath: join(skillsDir, entry.name) },
              summary: parseSkillFrontmatter(skillMd, entry.name),
            })
          }
        }
      }
    } catch {
      // skip
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
    name: typeof data['name'] === 'string' ? data['name'] : fallbackName,
    description: typeof data['description'] === 'string' ? data['description'] : '',
    trigger: typeof data['trigger'] === 'string' ? data['trigger'] : '',
    skip: typeof data['skip'] === 'string' ? data['skip'] : '',
    appliesTo: Array.isArray(data['appliesTo']) ? (data['appliesTo'] as unknown[]).filter(v => typeof v === 'string') as string[] : [],
  }
}

function updatePerPackageGuidelines(cwd: string, guidelines: PackageGuideline[]): number {
  if (guidelines.length === 0) return 0

  const dir = join(cwd, '.ai', 'guidelines')
  mkdirSync(dir, { recursive: true })

  for (const g of guidelines) {
    writeFileSync(join(dir, `${g.shortName}.md`), g.content, 'utf-8')
  }
  return guidelines.length
}

function updateSkills(cwd: string, skills: SkillEntry[]): number {
  if (skills.length === 0) return 0

  const dir = join(cwd, '.ai', 'skills')
  mkdirSync(dir, { recursive: true })

  for (const s of skills) {
    cpSync(s.sourcePath, join(dir, s.skillName), { recursive: true })
  }
  return skills.length
}

export interface BoostUpdateOptions {
  discover?: boolean
}

export async function boostUpdate(cwd: string, options?: BoostUpdateOptions): Promise<void> {
  console.log('\nBoost: Updating AI guidelines and skills...\n')

  const existing = readBoostJson(cwd)
  if (!existing) {
    console.log('  No boost.json found. Run `boost:install` first.')
    return
  }

  let packages = existing.packages

  if (options?.discover) {
    const installed = scanInstalledPackages(cwd)
    const newPackages = installed.filter((p) => !packages.includes(p))
    if (newPackages.length > 0) {
      console.log(`  Discovered ${newPackages.length} new package(s): ${newPackages.join(', ')}`)
      packages = [...packages, ...newPackages]
    }
  }

  // Collect fresh guidelines & skills
  const guidelines = collectGuidelines(cwd, packages)
  const guidelineMap = new Set(guidelines.map(g => g.packageName))
  const skills = collectSkills(cwd, packages)

  // Use the SAME generator as `boost:install` so the regenerated content keeps
  // the <rudderjs-boost-guidelines> markers (the splice in writeGuidelineBlock
  // targets that block) and stays format-consistent across install/update.
  const packageEntries: PackageEntry[] = packages.map(name => ({
    name,
    shortName: name.replace('@rudderjs/', ''),
    hasGuideline: guidelineMap.has(name),
  }))
  const guidelineContent = generateClaudeMd({
    cwd,
    packages: packageEntries,
    skills: skills.map(s => s.summary),
  })

  // Update per-package guidelines
  const guidelineCount = updatePerPackageGuidelines(cwd, guidelines)
  const skillCount = updateSkills(cwd, skills.map(s => s.entry))

  // Update per-agent guideline files
  const agentNames = existing.agents ?? ['claude-code']
  const allAgents = Boost.getAllAgents()
  let agentCount = 0

  for (const name of agentNames) {
    const agent = allAgents.find(a => a.name === name)
    if (!agent) continue

    if (agent.supportsGuidelines) {
      await agent.installGuidelines(cwd, guidelineContent)
      agentCount++
    }

    if (agent.supportsSkills && agent.installSkills && skills.length > 0) {
      await agent.installSkills(cwd, skills.map(s => s.entry))
    }
  }

  // Update boost.json — preserve the recorded skills list (install writes it;
  // dropping it here would silently lose data from the committed config).
  const config: BoostConfig = {
    version: existing.version,
    agents: agentNames,
    packages,
    skills: skills.map(s => s.summary.name),
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(cwd, 'boost.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8')

  console.log(`  ${guidelineCount} guideline(s), ${skillCount} skill(s) updated.`)
  if (agentCount > 0) {
    console.log(`  Updated guideline files for ${agentCount} agent(s): ${agentNames.join(', ')}`)
  }
  console.log('  Updated boost.json\n')
}
