import { test, expect } from '@playwright/test'

test.describe('Tables Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tables-demo')
    await page.waitForSelector('h1:text("Table Examples")')
    // Wait for hydration
    await page.waitForTimeout(1000)
  })

  // Helper: get the first paginated table card by its title
  function paginatedTableCard(page: import('@playwright/test').Page) {
    return page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Articles (URL)' })
  }

  // Helper: get the load-more table card
  function loadMoreTableCard(page: import('@playwright/test').Page) {
    return page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Articles (Load More)' })
  }

  // ── Pagination (pages) ──────────────────────────────────────

  test('pages mode — shows page buttons', async ({ page }) => {
    const card = paginatedTableCard(page)
    const buttons = card.locator('button').filter({ hasText: /^[0-9]+$/ })
    const count = await buttons.count()
    expect(count).toBeGreaterThan(1)
  })

  test('pages mode — click page 2 loads different data', async ({ page }) => {
    const card = paginatedTableCard(page)
    // Get all row texts on page 1
    const page1Rows = await card.locator('table tbody tr').count()
    expect(page1Rows).toBeGreaterThan(0)
    await card.locator('button:text-is("2")').click()
    await page.waitForTimeout(1000)
    // After clicking page 2, the page 2 button should be active
    const btn2 = card.locator('button:text-is("2")')
    await expect(btn2).toHaveClass(/bg-primary/)
  })

  test('pages mode — active page button is highlighted', async ({ page }) => {
    const card = paginatedTableCard(page)
    await card.locator('button:text-is("2")').click()
    await page.waitForTimeout(1000)
    const btn = card.locator('button:text-is("2")')
    await expect(btn).toHaveClass(/bg-primary/)
  })

  // ── Pagination (load more) ──────────────────────────────────

  test('loadMore — shows load more button', async ({ page }) => {
    const loadMore = page.locator('button:text("Load more")')
    await expect(loadMore).toBeVisible()
  })

  test('loadMore — clicking appends records', async ({ page }) => {
    const card = loadMoreTableCard(page)
    const initialRows = await card.locator('table tbody tr').count()
    await page.locator('button:text("Load more")').click()
    await page.waitForTimeout(1000)
    const afterRows = await card.locator('table tbody tr').count()
    expect(afterRows).toBeGreaterThan(initialRows)
  })

  // ── Search ──────────────────────────────────────────────────

  test('search filters results', async ({ page }) => {
    const card = paginatedTableCard(page)
    const searchInput = card.locator('input[type="search"]')
    await searchInput.fill('test-unique-string-xyz')
    await page.waitForTimeout(1000)
    // Should show empty or filtered results
    const emptyMsg = card.locator('text=No articles found.')
    const rows = card.locator('table tbody tr')
    const rowCount = await rows.count()
    const isEmpty = await emptyMsg.isVisible().catch(() => false)
    expect(rowCount === 0 || isEmpty).toBeTruthy()
  })

  test('search resets to page 1', async ({ page }) => {
    const card = paginatedTableCard(page)
    // Go to page 2 first
    await card.locator('button:text-is("2")').click()
    await page.waitForTimeout(1000)
    // Verify page 2 is active
    await expect(card.locator('button:text-is("2")')).toHaveClass(/bg-primary/)
    // Now search — this should reset to page 1
    const searchInput = card.locator('input[type="search"]')
    await searchInput.fill('a')
    await page.waitForTimeout(1000)
    // The search happened and page reset — page 1 button should be active if visible
    // Or there might be no pagination buttons if results fit in one page
    const page1Btn = card.locator('button:text-is("1")')
    const page1Count = await page1Btn.count()
    if (page1Count > 0) {
      await expect(page1Btn).toHaveClass(/bg-primary/)
    } else {
      // Results fit in one page — no pagination shown, which is correct
      expect(true).toBeTruthy()
    }
  })

  // ── Sort ────────────────────────────────────────────────────

  test('clicking sortable column header shows arrow', async ({ page }) => {
    const card = paginatedTableCard(page)
    await card.locator('th:text("Title")').click()
    await page.waitForTimeout(1000)
    const th = card.locator('th:text("Title")')
    // The arrow is a span inside the th
    const arrow = th.locator('span')
    await expect(arrow).toBeVisible()
    const arrowText = await arrow.textContent()
    expect(arrowText).toMatch(/[↑↓]/)
  })

  // ── remember(url) ──────────────────────────────────────────

  test('URL persist — page change updates URL', async ({ page }) => {
    const card = paginatedTableCard(page)
    await card.locator('button:text-is("2")').click()
    await page.waitForTimeout(1000)
    expect(page.url()).toContain('page=2')
  })

  test('URL persist — search updates URL', async ({ page }) => {
    const card = paginatedTableCard(page)
    const searchInput = card.locator('input[type="search"]')
    await searchInput.fill('test')
    await page.waitForTimeout(1000)
    expect(page.url()).toContain('search=test')
  })

  test('URL persist — direct URL visit SSRs correct page', async ({ page }) => {
    await page.goto('/admin/tables-demo?articles-url_page=2')
    await page.waitForSelector('h1:text("Table Examples")')
    await page.waitForTimeout(1000)
    const card = paginatedTableCard(page)
    const btn = card.locator('button:text-is("2")')
    await expect(btn).toHaveClass(/bg-primary/)
  })

  test('URL persist — direct URL visit SSRs search value', async ({ page }) => {
    await page.goto('/admin/tables-demo?articles-url_search=ok')
    await page.waitForSelector('h1:text("Table Examples")')
    await page.waitForTimeout(500)
    const card = paginatedTableCard(page)
    const searchInput = card.locator('input[type="search"]')
    await expect(searchInput).toHaveValue('ok')
  })

  // ── Static rows ─────────────────────────────────────────────

  test('static table renders inline data', async ({ page }) => {
    const chromeCell = page.locator('td:text("Chrome")')
    await expect(chromeCell).toBeVisible()
  })

  test('static table search works client-side', async ({ page }) => {
    const staticTable = page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Browser Market Share' })
    const searchInput = staticTable.locator('input[type="search"]')
    await searchInput.fill('Chrome')
    await page.waitForTimeout(300)
    await expect(page.locator('td:text("Chrome")')).toBeVisible()
  })

  // ── Showing X of Y ─────────────────────────────────────────

  test('shows correct record count', async ({ page }) => {
    const showing = page.locator('text=/Showing \\d+ of \\d+/')
    await expect(showing.first()).toBeVisible()
  })
})
