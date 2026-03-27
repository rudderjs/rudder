import { test, expect } from '@playwright/test'

test.describe('List Demo', () => {

  test('API search filters records', async ({ page, request }) => {
    // Visit page first to register List in TableRegistry
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(500)

    // API should now filter — note the new ID: list-demo-categories
    const res = await request.get('/admin/api/_tables/list-demo-categories?page=1&search=hello')
    const body = await res.json()
    console.log('Status:', res.status())
    console.log('Records:', body.records?.length)
    console.log('Names:', body.records?.map((r: any) => r.name))
    console.log('Pagination:', JSON.stringify(body.pagination))

    expect(res.status()).toBe(200)
    expect(body.records.length).toBeLessThanOrEqual(2)
  })

  test('search filters in browser', async ({ page }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(1000)

    // Wait for initial render
    const showingText = page.locator('text=/Showing \\d+ of \\d+/')
    await expect(showingText).toBeVisible({ timeout: 3000 })

    // Type search
    const input = page.locator('input[placeholder*="Search"]')
    await input.click()
    await input.type('hello', { delay: 50 })

    // Wait for debounce + fetch
    await page.waitForTimeout(1500)

    // Should show filtered results
    const items = page.locator('[class*="divide-y"] [class*="font-medium"]')
    const count = await items.count()
    console.log('Items after search:', count)
    expect(count).toBeLessThanOrEqual(2)
  })

  test('pagination works', async ({ page }) => {
    await page.goto('/admin/list-demo')
    await expect(page.locator('text=/Showing \\d+ of \\d+/')).toBeVisible({ timeout: 3000 })

    // Should have pagination buttons
    const page2 = page.locator('button:has-text("2")')
    await expect(page2).toBeVisible()

    // Click page 2
    await page2.click()
    await page.waitForTimeout(1000)

    // Records should change — check all view types
    const listItems = page.locator('[class*="divide-y"] [class*="font-medium"]')
    const gridItems = page.locator('[class*="grid-cols"] [class*="font-medium"]')
    const tableRows = page.locator('tbody tr')
    const count = Math.max(await listItems.count(), await gridItems.count(), await tableRows.count())
    console.log('Page 2 items:', count)
    expect(count).toBeGreaterThan(0)
  })

  test('view toggle works', async ({ page }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(1000)

    // Switch to Table view
    await page.locator('button[title="Table"]').click()
    await expect(page.locator('th:has-text("NAME")')).toBeVisible()

    // Switch to Grid view
    await page.locator('button[title="Grid"]').click()
    await expect(page.locator('[class*="grid-cols"]')).toBeVisible()

    // Switch to List view
    await page.locator('button[title="List"]').click()
    await expect(page.locator('[class*="divide-y"]')).toBeVisible()
  })
})
