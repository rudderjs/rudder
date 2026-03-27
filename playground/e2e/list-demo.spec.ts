import { test, expect } from '@playwright/test'

test.describe('List Demo', () => {

  test('API search filters records', async ({ page, request }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(500)
    const res = await request.get('/admin/api/_tables/list-demo-categories?page=1&search=hello')
    const body = await res.json()
    expect(res.status()).toBe(200)
    expect(body.records.length).toBeLessThanOrEqual(2)
  })

  test('export CSV downloads file', async ({ page, request }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(500)
    const res = await request.get('/admin/api/_tables/list-demo-categories/export?format=csv')
    expect(res.status()).toBe(200)
    const text = await res.text()
    console.log('CSV first 200 chars:', text.slice(0, 200))
    // Should have header row + data rows
    expect(text).toContain('name')
    expect(text).toContain('slug')
    expect(text.split('\n').length).toBeGreaterThan(1)
  })

  test('export JSON downloads file', async ({ page, request }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(500)
    const res = await request.get('/admin/api/_tables/list-demo-categories/export?format=json')
    expect(res.status()).toBe(200)
    const body = await res.json()
    console.log('JSON export count:', body.length)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(5) // all records, no pagination
  })

  test('export CSV with search filter', async ({ page, request }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(500)
    const res = await request.get('/admin/api/_tables/list-demo-categories/export?format=csv&search=hello')
    expect(res.status()).toBe(200)
    const text = await res.text()
    const lines = text.trim().split('\n')
    console.log('Filtered CSV lines:', lines.length)
    // Header + filtered rows (should be fewer than total)
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines.length).toBeGreaterThan(1) // at least header + 1 row
  })

  test('view toggle works', async ({ page }) => {
    await page.goto('/admin/list-demo')
    await page.waitForTimeout(1000)

    await page.locator('button[title="Table"]').click()
    await expect(page.locator('th:has-text("NAME")')).toBeVisible()

    await page.locator('button[title="Grid"]').click()
    await expect(page.locator('[class*="grid-cols"]')).toBeVisible()

    await page.locator('button[title="List"]').click()
    await expect(page.locator('[class*="divide-y"]')).toBeVisible()
  })

  test('pagination works', async ({ page }) => {
    await page.goto('/admin/list-demo')
    await expect(page.locator('text=/Showing \\d+ of \\d+/')).toBeVisible({ timeout: 3000 })
    const page2 = page.locator('button:has-text("2")')
    await expect(page2).toBeVisible()
    await page2.click()
    await page.waitForTimeout(1000)
    const listItems = page.locator('[class*="divide-y"] [class*="font-medium"]')
    const gridItems = page.locator('[class*="grid-cols"] [class*="font-medium"]')
    const tableRows = page.locator('tbody tr')
    const count = Math.max(await listItems.count(), await gridItems.count(), await tableRows.count())
    expect(count).toBeGreaterThan(0)
  })
})
