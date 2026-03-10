import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ServiceProvider, type Application } from '@boostkit/core'

export interface LocalizationConfig {
	locale: string
	fallback: string
	path: string
}

type TranslationMap = Record<string, unknown>

export class LocalizationRegistry {
	private static _config: LocalizationConfig = { locale: 'en', fallback: 'en', path: './lang' }
	private static _cache = new Map<string, TranslationMap>()
	private static _als = new AsyncLocalStorage<{ locale: string }>()

	static configure(config: LocalizationConfig): void {
		this._config = config
	}

	static getConfig(): LocalizationConfig {
		return this._config
	}

	static getAls(): AsyncLocalStorage<{ locale: string }> {
		return this._als
	}

	static seed(locale: string, namespace: string, data: TranslationMap): void {
		this._cache.set(`${locale}:${namespace}`, data)
	}

	static getCached(locale: string, namespace: string): TranslationMap | undefined {
		return this._cache.get(`${locale}:${namespace}`)
	}

	static setCached(locale: string, namespace: string, data: TranslationMap): void {
		this._cache.set(`${locale}:${namespace}`, data)
	}

	static reset(): void {
		this._cache.clear()
		this._config = { locale: 'en', fallback: 'en', path: './lang' }
	}
}

export function getLocale(): string {
	return LocalizationRegistry.getAls().getStore()?.locale ?? LocalizationRegistry.getConfig().locale
}

export function setLocale(locale: string): void {
	const store = LocalizationRegistry.getAls().getStore()
	if (store) store.locale = locale
}

export function runWithLocale<T>(locale: string, fn: () => T): T {
	return LocalizationRegistry.getAls().run({ locale }, fn)
}

async function loadNamespace(locale: string, namespace: string): Promise<TranslationMap> {
	const cached = LocalizationRegistry.getCached(locale, namespace)
	if (cached) return cached

	const { path } = LocalizationRegistry.getConfig()
	const filePath = join(path, locale, `${namespace}.json`)

	try {
		const raw = await readFile(filePath, 'utf-8')
		const data = JSON.parse(raw) as TranslationMap
		LocalizationRegistry.setCached(locale, namespace, data)
		return data
	} catch {
		return {}
	}
}

function resolveDotKey(obj: TranslationMap, key: string): string | undefined {
	const parts = key.split('.')
	let cur: unknown = obj

	for (const part of parts) {
		if (cur === null || typeof cur !== 'object') return undefined
		cur = (cur as Record<string, unknown>)[part]
	}

	return typeof cur === 'string' ? cur : undefined
}

function interpolate(template: string, params: Record<string, unknown>): string {
	return template.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
		const val = params[key]
		return val !== undefined ? String(val) : `:${key}`
	})
}

function pluralize(template: string, count: number): string {
	const parts = template.split('|')

	if (parts.length === 2 && !template.includes('{')) {
		return count === 1 ? (parts[0] ?? template) : (parts[1] ?? template)
	}

	let fallbackN: string | undefined

	for (const part of parts) {
		const match = part.match(/^\{(\d+|n)\}\s*(.*)$/)
		if (!match) continue

		const [, specifier, text] = match
		if (specifier === 'n') {
			fallbackN = text
		} else if (Number(specifier) === count) {
			return interpolate(text ?? '', { count })
		}
	}

	if (fallbackN !== undefined) {
		return interpolate(fallbackN, { count })
	}

	return template
}

function resolveFromCache(locale: string, namespace: string, key: string): string | undefined {
	const map = LocalizationRegistry.getCached(locale, namespace)
	if (!map) return undefined
	return resolveDotKey(map, key)
}

export function __(key: string, params?: Record<string, unknown> | number): string {
	const dotIndex = key.indexOf('.')
	if (dotIndex === -1) return key

	const namespace = key.slice(0, dotIndex)
	const nestedKey = key.slice(dotIndex + 1)
	const locale = getLocale()
	const { fallback } = LocalizationRegistry.getConfig()

	let raw = resolveFromCache(locale, namespace, nestedKey)
	if (raw === undefined && locale !== fallback) {
		raw = resolveFromCache(fallback, namespace, nestedKey)
	}

	if (raw === undefined) return key

	if (typeof params === 'number') {
		return pluralize(raw, params)
	}

	if (params && typeof params === 'object') {
		return interpolate(raw, params)
	}

	return raw
}

export async function trans(key: string, params?: Record<string, unknown> | number): Promise<string> {
	const dotIndex = key.indexOf('.')
	if (dotIndex === -1) return key

	const namespace = key.slice(0, dotIndex)
	const locale = getLocale()
	const { fallback } = LocalizationRegistry.getConfig()

	await loadNamespace(locale, namespace)
	if (locale !== fallback) await loadNamespace(fallback, namespace)

	return __(key, params)
}

export type SimpleMiddleware = (
	req: { headers: Record<string, string | string[] | undefined> },
	next: () => unknown,
) => unknown

export function LocalizationMiddleware() {
	return async function localizationMiddleware(
		req: { headers: Record<string, string | string[] | undefined> },
		next: () => unknown,
	): Promise<unknown> {
		const header = req.headers['accept-language']
		const raw = Array.isArray(header) ? header[0] : header
		const locale = raw?.split(',')[0]?.split('-')[0]?.trim() ?? LocalizationRegistry.getConfig().locale

		return runWithLocale(locale, () => next() as Promise<unknown>)
	}
}

export function localization(config: LocalizationConfig): new (app: Application) => ServiceProvider {
	class LocalizationServiceProvider extends ServiceProvider {
		register(): void {
			LocalizationRegistry.configure(config)
		}
	}

	return LocalizationServiceProvider
}
