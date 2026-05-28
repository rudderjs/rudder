import type { Customer } from './models/Customer.js'
import type { Subscription } from './models/Subscription.js'
import type { SubscriptionItem } from './models/SubscriptionItem.js'
import type { Transaction } from './models/Transaction.js'

// ─── Types ────────────────────────────────────────────────

export type BillableModelLike = abstract new (...args: any[]) => { id: unknown }

export interface CashierConfig {
  /** Paddle server-side API key. */
  apiKey?:                          string
  /** Paddle.js client-side token. */
  clientSideToken?:                 string
  /** Paddle Retain key (optional). */
  retainKey?:                       string
  /** Webhook signing secret. */
  webhookSecret?:                   string
  /** Use Paddle sandbox endpoints. */
  sandbox?:                         boolean
  /** Webhook receiver path. Default: '/paddle/webhook' */
  webhookPath?:                     string
  /** Default currency code (ISO 4217). Default: 'USD' */
  currency?:                        string
  /** Locale used by formatAmount(). Default: 'en' */
  currencyLocale?:                  string
  /** Treat past-due subscriptions as still subscribed. Default: false */
  keepPastDueSubscriptionsActive?:  boolean
  /** Override Cashier's bundled Eloquent-equivalent models. */
  models?: {
    customer?:         typeof Customer
    subscription?:     typeof Subscription
    subscriptionItem?: typeof SubscriptionItem
    transaction?:      typeof Transaction
    billable?:         BillableModelLike
  }
}

// ─── Cashier Configuration Singleton ─────────────────────

/**
 * Static configuration for `@rudderjs/cashier-paddle`.
 *
 * Mirrors Laravel's `Laravel\Paddle\Cashier` facade — call `useSubscriptionModel`,
 * `keepPastDueSubscriptionsActive`, etc. from a service provider's `register()`.
 *
 * The `Cashier.configure({...})` shortcut applies all keys at once and is what
 * `CashierPaddleProvider.boot()` invokes after reading `config('cashier')`.
 */
export class Cashier {
  // ── Credentials ────────────────────────────────────────
  private static _apiKey:          string | null = null
  private static _clientSideToken: string | null = null
  private static _retainKey:       string | null = null
  private static _webhookSecret:   string | null = null

  // ── Behavior ──────────────────────────────────────────
  private static _sandbox             = false
  private static _webhookPath         = '/paddle/webhook'
  private static _currency            = 'USD'
  private static _currencyLocale      = 'en'
  private static _keepPastDueActive   = false
  private static _routesIgnored       = false

  // ── Custom Models ─────────────────────────────────────
  private static _customerModel:         typeof Customer         | null = null
  private static _subscriptionModel:     typeof Subscription     | null = null
  private static _subscriptionItemModel: typeof SubscriptionItem | null = null
  private static _transactionModel:      typeof Transaction      | null = null
  private static _billableModel:         BillableModelLike       | null = null

  // ── Apply config en bloc ──────────────────────────────

  static configure(cfg: CashierConfig): void {
    if (cfg.apiKey          !== undefined) this._apiKey          = cfg.apiKey || null
    if (cfg.clientSideToken !== undefined) this._clientSideToken = cfg.clientSideToken || null
    if (cfg.retainKey       !== undefined) this._retainKey       = cfg.retainKey || null
    if (cfg.webhookSecret   !== undefined) this._webhookSecret   = cfg.webhookSecret || null
    if (cfg.sandbox         !== undefined) this._sandbox         = !!cfg.sandbox
    if (cfg.webhookPath     !== undefined) this._webhookPath     = cfg.webhookPath
    if (cfg.currency        !== undefined) this._currency        = cfg.currency
    if (cfg.currencyLocale  !== undefined) this._currencyLocale  = cfg.currencyLocale
    if (cfg.keepPastDueSubscriptionsActive !== undefined) {
      this._keepPastDueActive = !!cfg.keepPastDueSubscriptionsActive
    }
    if (cfg.models) {
      if (cfg.models.customer)         this._customerModel         = cfg.models.customer
      if (cfg.models.subscription)     this._subscriptionModel     = cfg.models.subscription
      if (cfg.models.subscriptionItem) this._subscriptionItemModel = cfg.models.subscriptionItem
      if (cfg.models.transaction)      this._transactionModel      = cfg.models.transaction
      if (cfg.models.billable)         this._billableModel         = cfg.models.billable
    }
  }

  // ── Credential getters ─────────────────────────────────

  static apiKey():          string | null { return this._apiKey }
  static clientSideToken(): string | null { return this._clientSideToken }
  static retainKey():       string | null { return this._retainKey }
  static webhookSecret():   string | null { return this._webhookSecret }

  // ── Behavior getters/setters ───────────────────────────

  static sandbox(flag?: boolean): boolean {
    if (flag !== undefined) this._sandbox = flag
    return this._sandbox
  }

  static webhookPath(path?: string): string {
    if (path !== undefined) this._webhookPath = path
    return this._webhookPath
  }

  static currency(code?: string): string {
    if (code !== undefined) this._currency = code
    return this._currency
  }

  static currencyLocale(locale?: string): string {
    if (locale !== undefined) this._currencyLocale = locale
    return this._currencyLocale
  }

  /** Toggle past-due-as-subscribed semantics. */
  static keepPastDueSubscriptionsActive(flag = true): void {
    this._keepPastDueActive = flag
  }

  static pastDueIsActive(): boolean {
    return this._keepPastDueActive
  }

  // ── Route auto-registration toggle ────────────────────

  static ignoreRoutes(): void { this._routesIgnored = true }
  static routesIgnored(): boolean { return this._routesIgnored }

  // ── Custom Model registration ─────────────────────────

  static useCustomerModel(cls: typeof Customer):                 void { this._customerModel         = cls }
  static useSubscriptionModel(cls: typeof Subscription):         void { this._subscriptionModel     = cls }
  static useSubscriptionItemModel(cls: typeof SubscriptionItem): void { this._subscriptionItemModel = cls }
  static useTransactionModel(cls: typeof Transaction):           void { this._transactionModel      = cls }
  static useBillableModel(cls: BillableModelLike):               void { this._billableModel         = cls }

  // ── Lazy model resolvers ──────────────────────────────

  static async customerModel(): Promise<typeof Customer> {
    if (this._customerModel) return this._customerModel
    return (await import('./models/Customer.js')).Customer
  }
  static async subscriptionModel(): Promise<typeof Subscription> {
    if (this._subscriptionModel) return this._subscriptionModel
    return (await import('./models/Subscription.js')).Subscription
  }
  static async subscriptionItemModel(): Promise<typeof SubscriptionItem> {
    if (this._subscriptionItemModel) return this._subscriptionItemModel
    return (await import('./models/SubscriptionItem.js')).SubscriptionItem
  }
  static async transactionModel(): Promise<typeof Transaction> {
    if (this._transactionModel) return this._transactionModel
    return (await import('./models/Transaction.js')).Transaction
  }

  static billableModel(): BillableModelLike | null {
    return this._billableModel
  }

  /** The `billable_type` string written to the customer row for the configured model. */
  static billableTypeName(): string {
    return this._billableModel?.name ?? 'User'
  }

  // ── Reset (testing) ────────────────────────────────────

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    this._apiKey          = null
    this._clientSideToken = null
    this._retainKey       = null
    this._webhookSecret   = null
    this._sandbox             = false
    this._webhookPath         = '/paddle/webhook'
    this._currency            = 'USD'
    this._currencyLocale      = 'en'
    this._keepPastDueActive   = false
    this._routesIgnored       = false
    this._customerModel         = null
    this._subscriptionModel     = null
    this._subscriptionItemModel = null
    this._transactionModel      = null
    this._billableModel         = null
  }
}
