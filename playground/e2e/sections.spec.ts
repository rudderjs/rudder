import { test, expect } from '@playwright/test'

test.describe('Sections Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/sections-demo')
    await page.waitForSelector('h1:text("Section Examples")')
    // Wait for React hydration
    await page.waitForTimeout(2000)
  })

  test('basic section renders with title', async ({ page }) => {
    // "Overview" section title — use exact text to avoid matching "Dashboard Overview" etc.
    const section = page.locator('.rounded-xl.border.bg-card').filter({ hasText: /^Overview/ })
    await expect(section.first()).toBeVisible()
  })

  test('section with description shows subtitle', async ({ page }) => {
    await expect(page.locator('text=Traffic and content metrics for the last 6 months.')).toBeVisible()
  })

  test('collapsible section can be toggled', async ({ page }) => {
    // Quick Links is collapsible and starts open
    await expect(page.locator('text=Documentation').first()).toBeVisible()
    // Click the Quick Links header to collapse
    const quickLinksHeader = page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Quick Links' }).locator('.cursor-pointer')
    await quickLinksHeader.click()
    await page.waitForTimeout(300)
    await expect(page.locator('a:text("Documentation")')).not.toBeVisible()
    // Click to expand
    await quickLinksHeader.click()
    await page.waitForTimeout(300)
    await expect(page.locator('a:text("Documentation")')).toBeVisible()
  })

  test('collapsed by default section starts hidden', async ({ page }) => {
    // Advanced Settings starts collapsed
    await expect(page.locator('text=Optional configuration')).toBeVisible() // description visible
    await expect(page.locator('text=Cache Hit Rate')).not.toBeVisible() // content hidden
    // Click to expand
    const advancedHeader = page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Advanced Settings' }).locator('.cursor-pointer')
    await advancedHeader.click()
    await page.waitForTimeout(300)
    await expect(page.locator('text=Cache Hit Rate')).toBeVisible()
  })

  test('section with table renders table', async ({ page }) => {
    await expect(page.locator('text=The latest 5 articles.')).toBeVisible()
    const table = page.locator('table').first()
    await expect(table).toBeVisible()
  })

  test('section with tabs renders tabs', async ({ page }) => {
    // Content Overview section has tabs
    const contentSection = page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Content Overview' })
    await expect(contentSection.locator('button:text-is("Articles")')).toBeVisible()
    await expect(contentSection.locator('button:text-is("Stats")')).toBeVisible()
    await expect(contentSection.locator('button:text-is("Chart")')).toBeVisible()
  })

  test('section with tabs — switching works', async ({ page }) => {
    const contentSection = page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Content Overview' })
    await contentSection.locator('button:text-is("Stats")').click()
    await page.waitForSelector('text=Total', { timeout: 10000 })
    await expect(page.locator('text=Total').first()).toBeVisible()
  })

  test('section with dialog renders trigger button', async ({ page }) => {
    await expect(page.locator('button:text("Send Feedback")')).toBeVisible()
  })

  test('section with dialog — clicking opens modal', async ({ page }) => {
    await page.locator('button:text("Send Feedback")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('text=Tell us what you think.')).toBeVisible()
  })

  test('section with form renders form', async ({ page }) => {
    // The form is inside a section titled "Contact Us"
    const contactSection = page.locator('.rounded-xl.border.bg-card').filter({ hasText: 'Contact Us' })
    await expect(contactSection).toBeVisible()
    await expect(contactSection.locator('button:text("Send")')).toBeVisible()
  })
})
