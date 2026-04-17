import * as fs from 'node:fs'
import * as path from 'node:path'

export interface DocSection {
  package: string
  file: string
  heading: string
  content: string
}

export interface SearchResult {
  package: string
  file: string
  heading: string
  excerpt: string
  score: number
}

let cachedIndex: DocSection[] | undefined

/**
 * Build the documentation index by scanning @rudderjs/* packages
 * for README.md and docs/**\/*.md files.
 */
function buildIndex(cwd: string): DocSection[] {
  const sections: DocSection[] = []
  const nodeModules = path.join(cwd, 'node_modules', '@rudderjs')

  if (!fs.existsSync(nodeModules)) return sections

  const packages = fs.readdirSync(nodeModules)

  for (const pkg of packages) {
    const pkgDir = path.join(nodeModules, pkg)
    if (!fs.statSync(pkgDir).isDirectory()) continue

    const mdFiles: string[] = []

    // README.md
    const readme = path.join(pkgDir, 'README.md')
    if (fs.existsSync(readme)) mdFiles.push(readme)

    // docs/**/*.md
    const docsDir = path.join(pkgDir, 'docs')
    if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
      collectMdFiles(docsDir, mdFiles)
    }

    for (const filePath of mdFiles) {
      const content = fs.readFileSync(filePath, 'utf8')
      const relFile = path.relative(pkgDir, filePath)
      const fileSections = splitByHeadings(content)

      for (const section of fileSections) {
        sections.push({
          package: `@rudderjs/${pkg}`,
          file: relFile,
          heading: section.heading,
          content: section.content,
        })
      }
    }
  }

  return sections
}

function collectMdFiles(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMdFiles(full, out)
    } else if (entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
}

function splitByHeadings(content: string): { heading: string; content: string }[] {
  const lines = content.split('\n')
  const sections: { heading: string; content: string }[] = []
  let currentHeading = '(top)'
  let currentLines: string[] = []

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)/)
    if (match) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() })
      }
      currentHeading = match[1]!.trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() })
  }

  return sections
}

function getIndex(cwd: string): DocSection[] {
  if (!cachedIndex) {
    cachedIndex = buildIndex(cwd)
  }
  return cachedIndex
}

function scoreSection(section: DocSection, queryWords: string[], queryLower: string): number {
  const text = `${section.heading} ${section.content}`.toLowerCase()

  // Exact phrase match — highest score
  if (text.includes(queryLower)) return 3

  // All words present
  const matchCount = queryWords.filter(w => text.includes(w)).length
  if (matchCount === queryWords.length) return 2

  // Partial overlap
  if (matchCount > 0) return matchCount / queryWords.length

  return 0
}

/**
 * Search the documentation index for sections matching the query.
 */
export function searchDocs(
  cwd: string,
  query: string,
  pkg?: string,
  limit?: number,
): SearchResult[] {
  const maxResults = limit ?? 10
  const index = getIndex(cwd)
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0)

  if (queryWords.length === 0) return []

  let filtered = index
  if (pkg) {
    const normalized = pkg.startsWith('@rudderjs/') ? pkg : `@rudderjs/${pkg}`
    filtered = index.filter(s => s.package === normalized)
  }

  const scored: SearchResult[] = []

  for (const section of filtered) {
    const score = scoreSection(section, queryWords, queryLower)
    if (score > 0) {
      scored.push({
        package: section.package,
        file: section.file,
        heading: section.heading,
        excerpt: section.content.slice(0, 300),
        score,
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxResults)
}
