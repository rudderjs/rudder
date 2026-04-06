// ─── Attribute (Accessor / Mutator) ────────────────────────

export interface AttributeConfig<TGet = unknown, TSet = unknown> {
  /** Transform the raw stored value when reading (accessor). */
  get?: (value: unknown, attributes: Record<string, unknown>) => TGet
  /** Transform the value before writing to the database (mutator). */
  set?: (value: TSet, attributes: Record<string, unknown>) => unknown
}

/**
 * Defines a model accessor and/or mutator for a property.
 *
 * @example
 * class User extends Model {
 *   static attributes = {
 *     // Accessor only — capitalises first name on read
 *     firstName: Attribute.make({
 *       get: (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1),
 *     }),
 *
 *     // Mutator only — hash password on write
 *     password: Attribute.make({
 *       set: async (v) => await bcrypt.hash(String(v), 10),
 *     }),
 *
 *     // Computed property from multiple columns (accessor only)
 *     fullName: Attribute.make({
 *       get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
 *     }),
 *   }
 * }
 */
export class Attribute<TGet = unknown, TSet = unknown> {
  private constructor(
    readonly getter: ((value: unknown, attributes: Record<string, unknown>) => TGet) | undefined,
    readonly setter: ((value: TSet, attributes: Record<string, unknown>) => unknown) | undefined,
  ) {}

  static make<TGet = unknown, TSet = unknown>(
    config: AttributeConfig<TGet, TSet>,
  ): Attribute<TGet, TSet> {
    return new Attribute(config.get, config.set)
  }
}
