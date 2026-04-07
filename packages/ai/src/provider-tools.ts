import { z } from 'zod'
import { toolDefinition } from './tool.js'

/**
 * Web search tool — uses provider-native web search when available.
 * Falls back to a server-side DuckDuckGo fetch for providers without native support.
 */
export class WebSearch {
  private _domains: string[] | undefined
  private _maxResults: number | undefined

  private constructor() {}

  static make(): WebSearch {
    return new WebSearch()
  }

  domains(domains: string[]): this {
    this._domains = domains
    return this
  }

  maxResults(n: number): this {
    this._maxResults = n
    return this
  }

  /** Convert to a tool definition that can be added to an agent's tools array */
  toTool() {
    const domains = this._domains
    const maxResults = this._maxResults

    return toolDefinition({
      name: 'web_search',
      description: 'Search the web for current information.',
      inputSchema: z.object({
        query: z.string().describe('The search query'),
      }),
      meta: {
        providerNative: true,
        type: 'web_search',
        domains,
        maxResults,
      },
    }).server(async ({ query }) => {
      // Fallback: simple server-side search via fetch
      // Runs only if the provider doesn't handle it natively
      try {
        const url = new URL('https://html.duckduckgo.com/html/')
        url.searchParams.set('q', query + (domains ? ` site:${domains.join(' OR site:')}` : ''))
        const res = await fetch(url.toString(), { headers: { 'User-Agent': 'RudderJS/1.0' } })
        const html = await res.text()
        const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
        return { results: text }
      } catch {
        return { error: 'Web search unavailable' }
      }
    })
  }
}

/**
 * Web fetch tool — fetches a web page and returns its text content.
 */
export class WebFetch {
  private _maxLength: number | undefined

  private constructor() {}

  static make(): WebFetch {
    return new WebFetch()
  }

  maxLength(n: number): this {
    this._maxLength = n
    return this
  }

  toTool() {
    const maxLength = this._maxLength ?? 10000

    return toolDefinition({
      name: 'web_fetch',
      description: 'Fetch a web page and return its text content.',
      inputSchema: z.object({
        url: z.string().url().describe('The URL to fetch'),
      }),
      meta: {
        providerNative: true,
        type: 'web_fetch',
        maxLength,
      },
    }).server(async ({ url: targetUrl }) => {
      try {
        const res = await fetch(targetUrl, {
          headers: { 'User-Agent': 'RudderJS/1.0' },
          signal: AbortSignal.timeout(10000),
        })
        const html = await res.text()
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLength)
        return { content: text, url: targetUrl, status: res.status }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Fetch failed', url: targetUrl }
      }
    })
  }
}

/**
 * Code execution tool — uses provider-native code interpreter when available.
 * No server-side fallback for security — returns an error if the provider
 * doesn't support native code execution.
 */
export class CodeExecution {
  private constructor() {}

  static make(): CodeExecution {
    return new CodeExecution()
  }

  toTool() {
    return toolDefinition({
      name: 'code_execution',
      description: 'Execute code to perform calculations, data analysis, or generate outputs.',
      inputSchema: z.object({
        code: z.string().describe('The code to execute'),
        language: z.string().default('javascript').describe('Programming language'),
      }),
      meta: {
        providerNative: true,
        type: 'code_execution',
      },
    }).server(async ({ code, language }) => {
      // No server-side fallback for security — must be handled by provider
      return {
        error: `Code execution requires a provider with native code interpreter support. Language: ${language}, code length: ${code.length}`,
      }
    })
  }
}
