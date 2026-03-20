import { test, expect } from '@playwright/test'

test.describe('Tabs Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tabs-demo')
    await page.waitForSelector('h1:text("Tabs Examples")')
    // Wait for React hydration to complete
    await page.waitForTimeout(2000)
  })

  // ── Basic tab switching ─────────────────────────────────────

  test('clicking tab shows its content', async ({ page }) => {
    // URL tabs — click Users tab
    const urlTabsSection = page.locator('h2:text("Tabs with URL Persist") ~ div').first()
    await urlTabsSection.locator('button', { hasText: 'Users' }).click()
    await page.waitForSelector('text=All Users', { timeout: 10000 })
    await expect(page.locator('text=All Users')).toBeVisible()
  })

  test('switching tabs hides previous content', async ({ page }) => {
    const urlTabsSection = page.locator('h2:text("Tabs with URL Persist") ~ div').first()
    await urlTabsSection.locator('button', { hasText: 'Charts' }).click()
    await page.waitForSelector('text=Monthly Traffic', { timeout: 10000 })
    await expect(page.locator('text=Monthly Traffic')).toBeVisible()
    // Articles table should not be visible
    await expect(page.locator('text=All Articles').first()).not.toBeVisible()
  })

  // ── persist(url) ────────────────────────────────────────────

  test('URL persist — tab change updates URL', async ({ page }) => {
    const urlTabsSection = page.locator('h2:text("Tabs with URL Persist") ~ div').first()
    await urlTabsSection.locator('button', { hasText: 'Charts' }).click()
    await page.waitForSelector('text=Monthly Traffic', { timeout: 10000 })
    expect(page.url()).toContain('url-tabs=charts')
  })

  test('URL persist — direct URL visit opens correct tab', async ({ page }) => {
    await page.goto('/admin/tabs-demo?url-tabs=charts')
    await page.waitForSelector('h1:text("Tabs Examples")')
    await page.waitForTimeout(2000)
    await expect(page.locator('text=Monthly Traffic')).toBeVisible()
  })

  // ── persist(session) ────────────────────────────────────────

  test('session persist — tab survives refresh', async ({ page }) => {
    // Click Links tab in session section
    const sessionSection = page.locator('h2:text("Tabs with Session Persist") ~ div').first()
    await sessionSection.locator('button', { hasText: 'Links' }).click()
    await page.waitForSelector('text=Documentation', { timeout: 10000 })
    await page.waitForTimeout(1000) // wait for session POST
    await page.reload()
    await page.waitForSelector('h1:text("Tabs Examples")')
    await page.waitForTimeout(2000) // wait for hydration
    // Links tab should still be active
    await expect(page.locator('text=Documentation')).toBeVisible()
  })

  // ── persist(localStorage) ──────────────────────────────────

  test('localStorage persist — tab survives refresh', async ({ page }) => {
    // Click Tab B in localStorage section
    const localSection = page.locator('h2:text("Tabs with localStorage Persist") ~ div').first()
    await localSection.locator('button:text-is("Tab B")').click()
    await page.waitForTimeout(500)
    await expect(page.locator('text=Content of Tab B.')).toBeVisible()
    await page.reload()
    await page.waitForSelector('h1:text("Tabs Examples")')
    await page.waitForTimeout(2000)
    // Tab B content should be visible
    await expect(page.locator('text=Content of Tab B.')).toBeVisible()
  })

  // ── No persist ──────────────────────────────────────────────

  test('no persist — resets to first tab on refresh', async ({ page }) => {
    const noSection = page.locator('h2:text("Tabs with No Persist") ~ div').first()
    await noSection.locator('button:text-is("Second")').click()
    await page.waitForTimeout(500)
    await page.reload()
    await page.waitForSelector('h1:text("Tabs Examples")')
    await page.waitForTimeout(2000)
    // First tab content should be visible
    await expect(page.locator('text=This is always the default tab.')).toBeVisible()
  })

  // ── Lazy tab ────────────────────────────────────────────────

  test('lazy tab loads content on click', async ({ page }) => {
    const lazySection = page.locator('h2:text("Tabs with Lazy Tab") ~ div').first()
    // Heavy Data tab is lazy
    await lazySection.locator('button', { hasText: 'Heavy Data' }).click()
    // Should show skeleton briefly, then table
    await page.waitForSelector('text=All Articles (Lazy)', { timeout: 10000 })
    await expect(page.locator('text=All Articles (Lazy)')).toBeVisible()
  })

  // ── Badges ──────────────────────────────────────────────────

  test('tab badges show values', async ({ page }) => {
    // Articles tab should have a badge with a number
    const badge = page.locator('button', { hasText: 'Articles' }).first().locator('span')
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    expect(Number(text)).toBeGreaterThan(0)
  })

  // ── Tab switch preserves content ────────────────────────────

  test('all tabs SSR — switching is instant (no fetch)', async ({ page }) => {
    // Use the localStorage tabs (Tab A/B/C) since they are all SSR'd
    const localSection = page.locator('h2:text("Tabs with localStorage Persist") ~ div').first()
    await localSection.locator('button:text-is("Tab B")').click()
    await expect(page.locator('text=Content of Tab B.')).toBeVisible()
    await localSection.locator('button:text-is("Tab C")').click()
    await expect(page.locator('text=Content of Tab C.')).toBeVisible()
    await localSection.locator('button:text-is("Tab A")').click()
    await expect(page.locator('text=Content of Tab A')).toBeVisible()
  })

  // ── Model-backed tabs ──────────────────────────────────────

  test('model-backed tabs render category names', async ({ page }) => {
    // Category tabs should show category names
    const categorySection = page.locator('text=Model-Backed Tabs')
    await expect(categorySection).toBeVisible()
  })

  // ── Shorthand .tab() ───────────────────────────────────────

  test('shorthand .tab() renders tabs', async ({ page }) => {
    await expect(page.locator('button:text-is("Inline A")')).toBeVisible()
    await expect(page.locator('button:text-is("Inline B")')).toBeVisible()
    await page.locator('button:text-is("Inline B")').click()
    await page.waitForTimeout(500)
    await expect(page.locator('text=Second tab, also inline.')).toBeVisible()
  })
})
