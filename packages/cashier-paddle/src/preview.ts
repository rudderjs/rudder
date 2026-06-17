import { paddle } from './paddle-client.js'
import { formatAmount } from './format.js'

export interface PreviewAddress {
  countryCode: string
  postalCode?: string
}

export interface PreviewOptions {
  customerId?: string
  address?:    PreviewAddress
  discountId?: string
  currency?:   string
}

export interface PreviewItem {
  priceId:        string
  productName:    string
  quantity:       number
  /** Formatted via the response's currency. */
  unitPrice:      string
  /** Formatted total for this line. */
  total:          string
  rawUnitPrice:   string
  rawTotal:       string
}

export interface PreviewResult {
  currency: string
  items:    PreviewItem[]
  /** Formatted. */
  subtotal: string
  tax:      string
  total:    string
  /** Raw minor-units strings. */
  rawSubtotal: string
  rawTax:      string
  rawTotal:    string
}

/**
 * Get a localized price preview from Paddle. Used to show "what would this
 * cost the customer right now" — accounts for taxes, discounts, currency.
 *
 * @example
 *   const prices = await previewPrices(['pri_abc'], {
 *     address: { countryCode: 'BE', postalCode: '1234' },
 *   })
 *   prices.items[0].total // → "€19.99"
 */
export async function previewPrices(priceIds: string[], opts: PreviewOptions = {}): Promise<PreviewResult> {
  const client = await paddle()
  const fn = client.pricingPreview['preview']
    ?? (client as unknown as { previews?: Record<string, (...a: unknown[]) => Promise<unknown>> }).previews?.['create']
  if (!fn) throw new Error('[Rudder Cashier] Paddle SDK has no `pricingPreview.preview` method.')

  const result = await fn.call(client.pricingPreview, {
    items:        priceIds.map((id) => ({ priceId: id, quantity: 1 })),
    customerId:   opts.customerId,
    address:      opts.address ? { countryCode: opts.address.countryCode, postalCode: opts.address.postalCode } : undefined,
    discountId:   opts.discountId,
    currencyCode: opts.currency,
  }) as PaddlePreviewResponse

  const currency = result.currencyCode ?? opts.currency ?? 'USD'
  const totals   = result.details?.totals ?? result.totals ?? { subtotal: '0', tax: '0', total: '0' }
  const items    = (result.details?.lineItems ?? result.lineItems ?? []).map((it) => {
    const unitPrice = it.unitPrice?.amount ?? it.formattedUnitPrice ?? '0'
    const total     = it.formattedTotal ?? it.total ?? '0'
    return {
      priceId:      it.price?.id ?? it.priceId ?? '',
      productName:  it.product?.name ?? it.productName ?? '',
      quantity:     it.quantity ?? 1,
      unitPrice:    formatAmount(unitPrice, currency),
      total:        formatAmount(total, currency),
      rawUnitPrice: unitPrice,
      rawTotal:     total,
    }
  })

  return {
    currency,
    items,
    subtotal:    formatAmount(totals.subtotal, currency),
    tax:         formatAmount(totals.tax,      currency),
    total:       formatAmount(totals.total,    currency),
    rawSubtotal: totals.subtotal,
    rawTax:      totals.tax,
    rawTotal:    totals.total,
  }
}

// ─── SDK response shapes (loose) ──────────────────────────

interface PaddlePreviewResponse {
  currencyCode?: string
  details?: {
    totals?:    { subtotal: string; tax: string; total: string }
    lineItems?: PaddlePreviewLineItem[]
  }
  totals?:     { subtotal: string; tax: string; total: string }
  lineItems?:  PaddlePreviewLineItem[]
}

interface PaddlePreviewLineItem {
  price?:     { id: string }
  priceId?:   string
  product?:   { name: string }
  productName?: string
  quantity?:  number
  unitPrice?: { amount: string }
  formattedUnitPrice?: string
  formattedTotal?: string
  total?:     string
}
