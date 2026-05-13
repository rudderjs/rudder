import type { Model, RelationDefinition } from '../index.js'
import { camelHead } from '../utils.js'

// ─── Type narrowings ───────────────────────────────────────

export type BelongsToManyDef = Extract<RelationDefinition, { type: 'belongsToMany' }>
export type MorphParentDef   = Extract<RelationDefinition, { type: 'morphMany' | 'morphOne' }>
export type MorphToManyDef   = Extract<RelationDefinition, { type: 'morphToMany' }>
export type MorphedByManyDef = Extract<RelationDefinition, { type: 'morphedByMany' }>

// ─── Resolved-meta shapes ──────────────────────────────────

export interface BelongsToManyMeta {
  pivotTable:      string
  foreignPivotKey: string
  relatedPivotKey: string
  parentKey:       string
  relatedKey:      string
}

export interface MorphToManyMeta {
  pivotTable:      string
  /** `{morphName}Id` — pivot column for the parent (the polymorphic side). */
  foreignPivotKey: string
  /** `{morphName}Type` — discriminator column on the pivot. */
  morphTypeKey:    string
  /** Discriminator value to write/match for the parent class. */
  morphTypeValue:  string
  /** Pivot column for the related (strong) row. */
  relatedPivotKey: string
  parentKey:       string
  relatedKey:      string
}

export interface MorphedByManyMeta {
  pivotTable:      string
  /** `{morphName}Id` — pivot column for the related (polymorphic-side) row. */
  relatedPivotKey: string
  /** `{morphName}Type` — discriminator column on the pivot. */
  morphTypeKey:    string
  /** Discriminator value used to match rows that point at Related. */
  morphTypeValue:  string
  /** Pivot column for the parent (strong) row. */
  foreignPivotKey: string
  parentKey:       string
  relatedKey:      string
}

// ─── Resolvers ─────────────────────────────────────────────

export function resolveBelongsToManyMeta(
  Parent:  typeof Model,
  Related: typeof Model,
  def:     BelongsToManyDef,
): BelongsToManyMeta {
  return {
    pivotTable:      def.pivotTable,
    foreignPivotKey: def.foreignPivotKey ?? `${camelHead(Parent.name)}Id`,
    relatedPivotKey: def.relatedPivotKey ?? `${camelHead(Related.name)}Id`,
    parentKey:       def.parentKey       ?? Parent.primaryKey,
    relatedKey:      def.relatedKey      ?? Related.primaryKey,
  }
}

export function resolveMorphToManyMeta(
  Parent:  typeof Model,
  Related: typeof Model,
  def:     MorphToManyDef,
): MorphToManyMeta {
  return {
    pivotTable:      def.pivotTable,
    foreignPivotKey: `${def.morphName}Id`,
    morphTypeKey:    `${def.morphName}Type`,
    morphTypeValue:  def.morphType ?? Parent.morphAlias ?? Parent.name,
    relatedPivotKey: def.relatedPivotKey ?? `${camelHead(Related.name)}Id`,
    parentKey:       def.parentKey       ?? Parent.primaryKey,
    relatedKey:      def.relatedKey      ?? Related.primaryKey,
  }
}

export function resolveMorphedByManyMeta(
  Parent:  typeof Model,
  Related: typeof Model,
  def:     MorphedByManyDef,
): MorphedByManyMeta {
  return {
    pivotTable:      def.pivotTable,
    relatedPivotKey: `${def.morphName}Id`,
    morphTypeKey:    `${def.morphName}Type`,
    morphTypeValue:  def.morphType ?? Related.morphAlias ?? Related.name,
    foreignPivotKey: def.foreignPivotKey ?? `${camelHead(Parent.name)}Id`,
    parentKey:       def.parentKey       ?? Parent.primaryKey,
    relatedKey:      def.relatedKey      ?? Related.primaryKey,
  }
}
