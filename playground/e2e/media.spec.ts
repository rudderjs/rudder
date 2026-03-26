import { test, expect, type Page } from '@playwright/test'

/**
 * Media element e2e tests.
 * Tests the Media.make() schema element at /admin/media-demo.
 */

const MEDIA_URL = '/admin/media-demo'

async function waitForMedia(page: Page) {
  await page.waitForSelector('text=Files', { timeout: 15000 })
  await page.waitForTimeout(3000)
}

async function getItemCount(page: Page): Promise<number> {
  return page.locator('.grid > div').count()
}

async function getItemNames(page: Page): Promise<string[]> {
  const gridItems = page.locator('.grid > div')
  const count = await gridItems.count()
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const text = await gridItems.nth(i).locator('p').first().textContent()
    if (text) names.push(text.trim())
  }
  return names.filter(n => n.length > 0)
}

// ── Tests ───────────────────────────────────────────────────

test.describe('Media Element', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[browser:error] ${msg.text().slice(0, 200)}`)
    })
  })

  test('loads and shows items', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)
    const count = await getItemCount(page)
    console.log('Item count:', count)
    expect(count).toBeGreaterThan(0)
  })

  test('library switcher shows different items', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    const selector = page.locator('select').first()
    if (await selector.isVisible()) {
      const firstNames = await getItemNames(page)
      console.log('Library 1:', firstNames)

      await selector.selectOption({ index: 1 })
      await page.waitForTimeout(2000)
      const secondNames = await getItemNames(page)
      console.log('Library 2:', secondNames)

      // Libraries should have different content (or both empty)
      if (firstNames.length > 0 && secondNames.length > 0) {
        expect(secondNames).not.toEqual(firstNames)
      }
    }
  })

  test('search filters items', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    const searchInput = page.locator('input[type="search"]')
    if (await searchInput.isVisible()) {
      const beforeCount = await getItemCount(page)
      expect(beforeCount).toBeGreaterThan(0)

      await searchInput.fill('zzzznotexist')
      await page.waitForTimeout(1500)
      const emptyCount = await getItemCount(page)
      expect(emptyCount).toBe(0)

      await searchInput.fill('')
      await page.waitForTimeout(1500)
      const clearedCount = await getItemCount(page)
      expect(clearedCount).toBeGreaterThan(0)
    }
  })

  test('create folder appears in library', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    const folderName = `test-folder-${Date.now().toString().slice(-6)}`

    await page.click('button:text("+ Folder")')
    await page.waitForTimeout(500)
    await page.locator('input[placeholder="Folder name"]').fill(folderName)
    await page.click('button:text("Create")')
    await page.waitForTimeout(2000)

    // Search for the folder to find it (might be on another page due to pagination)
    const searchInput = page.locator('input[type="search"]')
    if (await searchInput.isVisible()) {
      await searchInput.fill(folderName)
      await page.waitForTimeout(1500)
    }

    const names = await getItemNames(page)
    console.log('After create + search:', names)
    expect(names).toContain(folderName)
  })

  test('upload file', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    const filename = `test-${Date.now()}.txt`
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: filename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Hello from Playwright test'),
    })
    await page.waitForTimeout(3000)

    // Search for the uploaded file
    const searchInput = page.locator('input[type="search"]')
    if (await searchInput.isVisible()) {
      await searchInput.fill(filename)
      await page.waitForTimeout(1500)
    }

    const names = await getItemNames(page)
    console.log('After upload + search:', names)
    expect(names.some(n => n.includes('test-'))).toBe(true)
  })

  test('pagination controls', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    const nextBtn = page.locator('button:text("→")')
    if (await nextBtn.isVisible() && !await nextBtn.isDisabled()) {
      const firstPageNames = await getItemNames(page)
      await nextBtn.click()
      await page.waitForTimeout(2000)
      const secondPageNames = await getItemNames(page)
      console.log('Page 1:', firstPageNames.length, 'Page 2:', secondPageNames.length)
      expect(secondPageNames).not.toEqual(firstPageNames)

      const prevBtn = page.locator('button:text("←")')
      await prevBtn.click()
      await page.waitForTimeout(2000)
      const backNames = await getItemNames(page)
      expect(backNames).toEqual(firstPageNames)
    } else {
      console.log('No pagination or only 1 page')
    }
  })

  test('navigate into folder and back', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    // Find folders (amber icon)
    const folderItems = page.locator('.grid > div:has(svg.text-amber-500)')
    const folderCount = await folderItems.count()

    if (folderCount > 0) {
      const folderName = (await folderItems.first().locator('p').first().textContent())?.trim() ?? ''
      console.log('Navigating into:', folderName)

      await folderItems.first().dblclick()
      await page.waitForTimeout(2000)

      // The media element's breadcrumb nav (inside the card, not the page breadcrumbs)
      // Should contain the folder name as a button
      const mediaBreadcrumbs = page.locator('nav button')
      const allBreadcrumbs = await mediaBreadcrumbs.allTextContents()
      console.log('Breadcrumbs:', allBreadcrumbs)
      expect(allBreadcrumbs.some(b => b.includes(folderName))).toBe(true)

      // Click root to go back
      await mediaBreadcrumbs.first().click()
      await page.waitForTimeout(2000)
      const rootCount = await getItemCount(page)
      expect(rootCount).toBeGreaterThan(0)
    } else {
      console.log('No folders')
    }
  })

  test('grid/list view toggle', async ({ page }) => {
    await page.goto(MEDIA_URL)
    await waitForMedia(page)

    const count = await getItemCount(page)
    expect(count).toBeGreaterThan(0)

    // View toggles are small SVG icon buttons
    // Just verify clicking doesn't crash and items remain
    const svgButtons = page.locator('button:has(svg[viewBox="0 0 16 16"])')
    const btnCount = await svgButtons.count()
    if (btnCount >= 2) {
      await svgButtons.nth(1).click()
      await page.waitForTimeout(500)
      await svgButtons.nth(0).click()
      await page.waitForTimeout(500)
    }

    const afterCount = await getItemCount(page)
    expect(afterCount).toBeGreaterThan(0)
  })
})
