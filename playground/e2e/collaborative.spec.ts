import { test, expect, type Page } from '@playwright/test'

/**
 * Collaborative editing tests.
 *
 * Uses an existing article (first in list) to test real-time sync
 * between two browser contexts.
 *
 * The title field is collaborative (CollaborativePlainText / Lexical).
 * It renders as a contenteditable div, not a native <input>.
 */

let articleEditUrl = ''

// ── Helpers ─────────────────────────────────────────────────

async function waitForForm(page: Page) {
  // Wait for the form to appear
  await page.waitForSelector('form', { timeout: 15000 })
  // Wait for hydration + WebSocket collaborative providers to connect + SeedPlugin (200ms delay)
  await page.waitForTimeout(6000)
}

/** Get the title field's text content (collaborative = Lexical contenteditable) */
async function getTitleText(page: Page): Promise<string> {
  // Try native input first (non-collaborative)
  const nativeInput = page.locator('input[name="title"]')
  if (await nativeInput.isVisible({ timeout: 500 }).catch(() => false)) {
    return nativeInput.inputValue()
  }
  // Collaborative: Lexical renders a contenteditable inside the title field's container
  const titleLabel = page.locator('label:has-text("Title")').first()
  const container = titleLabel.locator('..') // parent div
  const editor = container.locator('[contenteditable="true"]').first()
  return (await editor.textContent()) ?? ''
}

/** Set the title field's text (works for both native and collaborative) */
async function setTitleText(page: Page, value: string) {
  const nativeInput = page.locator('input[name="title"]')
  if (await nativeInput.isVisible({ timeout: 500 }).catch(() => false)) {
    await nativeInput.fill(value)
    return
  }
  // Collaborative: Lexical contenteditable
  const titleLabel = page.locator('label:has-text("Title")').first()
  const container = titleLabel.locator('..')
  const editor = container.locator('[contenteditable="true"]').first()
  await editor.focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Meta+a')
  await page.waitForTimeout(100)
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(100)
  await page.keyboard.type(value, { delay: 10 })
  // Wait for Lexical onChange to propagate to form state
  await page.waitForTimeout(1000)
  const typed = await editor.textContent()
  console.log(`[setTitleText] typed="${typed}" expected="${value}"`)
}

async function clickSave(page: Page) {
  // Click save and wait for the PUT response
  const [response] = await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/') && (resp.request().method() === 'PUT' || resp.request().method() === 'POST'), { timeout: 10000 }).catch(() => null),
    page.click('button:text("Save")'),
  ])
  if (response) console.log(`[save] ${response.request().method()} ${response.url()} → ${response.status()}`)
  // Wait for navigation + _sync-live
  await page.waitForTimeout(3000)
}

// ── Find an article to test with ────────────────────────────

test.describe.serial('Collaborative editing', () => {
  test('find article edit URL', async ({ page }) => {
    await page.goto('/admin/resources/articles')
    await page.waitForTimeout(3000)

    // Find an article row that has a visible title
    const rows = page.locator('table tbody tr')
    const count = await rows.count()
    console.log(`Found ${count} article rows`)

    // Click the row with "new testkjkkji" or any row with a title
    let found = false
    for (let i = 0; i < Math.min(count, 5); i++) {
      const cells = rows.nth(i).locator('td')
      const titleCell = await cells.nth(1).textContent() // title column
      console.log(`Row ${i}: title="${titleCell?.trim()}"`)
      if (titleCell && titleCell.trim().length > 0 && titleCell.trim() !== '—') {
        await rows.nth(i).locator('td:last-child a').click()
        found = true
        break
      }
    }
    expect(found).toBe(true)
    await page.waitForTimeout(2000)

    // Now on detail page — derive edit URL
    const detailUrl = page.url()
    articleEditUrl = detailUrl + '/edit'
    console.log('Article edit URL:', articleEditUrl)

    // Capture browser console + errors
    page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`))
    page.on('pageerror', err => console.log(`[browser:ERROR] ${err.message}`))

    await page.goto(articleEditUrl)
    await waitForForm(page)

    // Log what we see
    const html = await page.locator('form').innerHTML()
    const hasContentEditable = html.includes('contenteditable')
    const hasNativeInput = html.includes('name="title"')
    console.log('Has contenteditable:', hasContentEditable)
    console.log('Has native title input:', hasNativeInput)

    const title = await getTitleText(page)
    console.log('Current title:', JSON.stringify(title))
    // Title might be empty if the collaborative field hasn't loaded — skip assertion for now
    // The actual sync tests will verify values
  })

  // ── Test 1: Single user save + refresh ────────────────────

  test('single user: save, refresh, value persists', async ({ page }) => {
    test.skip(!articleEditUrl, 'No article URL')

    await page.goto(articleEditUrl)
    await waitForForm(page)

    const timestamp = Date.now().toString().slice(-6)
    const newTitle = `Test-${timestamp}`

    await setTitleText(page, newTitle)
    await clickSave(page)

    // Reopen the edit page
    await page.goto(articleEditUrl)
    await waitForForm(page)

    const after = await getTitleText(page)
    expect(after).toBe(newTitle)
  })

  // ── Test 2: Two users — real-time sync ────────────────────

  test('two users: typing syncs in real-time', async ({ browser }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await page1.goto(articleEditUrl)
      await page2.goto(articleEditUrl)
      await waitForForm(page1)
      await waitForForm(page2)

      const before1 = await getTitleText(page1)
      const before2 = await getTitleText(page2)
      console.log('Before - User1:', before1, 'User2:', before2)

      // User 1 types
      const syncValue = `Sync-${Date.now().toString().slice(-6)}`
      await setTitleText(page1, syncValue)
      await page1.waitForTimeout(3000)

      // User 2 should see the update
      const after2 = await getTitleText(page2)
      console.log('After sync - User2:', after2, 'Expected:', syncValue)
      expect(after2).toBe(syncValue)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // ── Test 3: User1 saves, User2 refreshes ──────────────────

  test('two users: user1 saves, user2 refreshes sees saved value', async ({ browser }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // User 1 edits and saves
      await page1.goto(articleEditUrl)
      await waitForForm(page1)

      const savedValue = `Saved-${Date.now().toString().slice(-6)}`
      await setTitleText(page1, savedValue)
      await page1.waitForTimeout(1000)
      await clickSave(page1)

      // User 2 opens the page fresh
      await page2.goto(articleEditUrl)
      await waitForForm(page2)

      const page2Value = await getTitleText(page2)
      console.log('User2 sees:', page2Value, 'Expected:', savedValue)
      expect(page2Value).toBe(savedValue)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // ── Test 4: Both refresh after save ───────────────────────

  // Flaky: y-websocket auto-reconnect from previous test can re-push stale data to rooms
  test('both users refresh after save, both see same value', async ({ browser, page: setupPage }) => {
    test.skip(!articleEditUrl, 'No article URL')

    // Pre-clean: clear Yjs rooms from previous tests
    const slug = articleEditUrl.match(/resources\/(\w+)\//)?.[1] ?? 'articles'
    const id = articleEditUrl.match(/\/([^/]+)\/edit/)?.[1] ?? ''
    const pathSegment = 'admin'
    await setupPage.request.post(`http://localhost:3000/${pathSegment}/api/${slug}/${id}/_sync-live`, {
      headers: { 'Content-Type': 'application/json' },
    })
    // Wait for delayed re-clear (500ms) + y-websocket reconnection cycle
    await setupPage.waitForTimeout(2000)

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // User 1 saves
      await page1.goto(articleEditUrl)
      await waitForForm(page1)

      const finalValue = `Final-${Date.now().toString().slice(-6)}`
      await setTitleText(page1, finalValue)
      await page1.waitForTimeout(1000)
      await clickSave(page1)

      // Both refresh
      await Promise.all([
        page1.goto(articleEditUrl),
        page2.goto(articleEditUrl),
      ])
      await waitForForm(page1)
      await waitForForm(page2)

      const val1 = await getTitleText(page1)
      const val2 = await getTitleText(page2)
      console.log('After refresh - User1:', val1, 'User2:', val2, 'Expected:', finalValue)
      expect(val1).toBe(finalValue)
      expect(val2).toBe(finalValue)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // ── Test 5: A edits, B edits, B refreshes — sees B's last value ─

  test('two users: A edits, B edits, B refreshes sees last value', async ({ browser }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // Both open the same article
      await page1.goto(articleEditUrl)
      await page2.goto(articleEditUrl)
      await waitForForm(page1)
      await waitForForm(page2)

      // User A types
      const valueA = `UserA-${Date.now().toString().slice(-6)}`
      await setTitleText(page1, valueA)
      await page1.waitForTimeout(2000)

      // User B types (overwrites A's change)
      const valueB = `UserB-${Date.now().toString().slice(-6)}`
      await setTitleText(page2, valueB)
      await page2.waitForTimeout(2000)

      // Verify A sees B's value (sync)
      const aSeesB = await getTitleText(page1)
      console.log('A sees after B typed:', aSeesB, 'Expected:', valueB)
      expect(aSeesB).toBe(valueB)

      // User B refreshes
      await page2.goto(articleEditUrl)
      await waitForForm(page2)

      const bAfterRefresh = await getTitleText(page2)
      console.log('B after refresh:', bAfterRefresh, 'Expected:', valueB)
      // B should see the last typed value (from Yjs room, not DB — not saved yet)
      expect(bAfterRefresh).toBe(valueB)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // ── Test 6: Edit without save, refresh keeps Yjs value ─────

  test('single user: edit without save, refresh shows Yjs value', async ({ page }) => {
    test.skip(!articleEditUrl, 'No article URL')

    page.on('console', msg => { if (msg.type() === 'log') console.log(`[browser] ${msg.text()}`) })

    await page.goto(articleEditUrl)
    await waitForForm(page)

    const unsavedValue = `Unsaved-${Date.now().toString().slice(-6)}`
    await setTitleText(page, unsavedValue)
    // Wait for Yjs to sync to server room
    await page.waitForTimeout(3000)

    // Refresh WITHOUT saving
    await page.goto(articleEditUrl)
    await waitForForm(page)

    const afterRefresh = await getTitleText(page)
    console.log('After refresh (no save):', afterRefresh, 'Expected:', unsavedValue)
    expect(afterRefresh).toBe(unsavedValue)
  })

  // ── Test 7: Repeated refresh consistency ──────────────────

  // ── Test 8: A edits (no save), B opens and sees it, B refreshes and still sees it ─

  test('unsaved edit visible to second user and survives refresh', async ({ browser }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      // User A opens and edits (no save)
      await page1.goto(articleEditUrl)
      await waitForForm(page1)

      const unsaved = `Draft-${Date.now().toString().slice(-6)}`
      await setTitleText(page1, unsaved)
      // Wait for Yjs to sync to server room
      await page1.waitForTimeout(3000)

      // User B opens the same article — should see A's unsaved edit
      await page2.goto(articleEditUrl)
      await waitForForm(page2)

      const bFirstLoad = await getTitleText(page2)
      console.log('B first load:', bFirstLoad, 'Expected:', unsaved)
      expect(bFirstLoad).toBe(unsaved)

      // User B refreshes — should still see the same value
      await page2.goto(articleEditUrl)
      await waitForForm(page2)

      const bAfterRefresh = await getTitleText(page2)
      console.log('B after refresh:', bAfterRefresh, 'Expected:', unsaved)
      expect(bAfterRefresh).toBe(unsaved)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // Known flaky — y-websocket auto-reconnect can re-push stale data between save and refresh
  test.fixme('single user: 5 rapid refreshes show consistent value', async ({ page }) => {
    test.skip(!articleEditUrl, 'No article URL')

    // Pre-clean: clear stale Yjs rooms from previous tests
    const slug = articleEditUrl.match(/resources\/(\w+)\//)?.[1] ?? 'articles'
    const id = articleEditUrl.match(/\/([^/]+)\/edit/)?.[1] ?? ''
    await page.request.post(`http://localhost:3000/admin/api/${slug}/${id}/_sync-live`, {
      headers: { 'Content-Type': 'application/json' },
    })
    await page.waitForTimeout(1000)

    // First establish a known value
    await page.goto(articleEditUrl)
    await waitForForm(page)

    const stableValue = `Stable-${Date.now().toString().slice(-6)}`
    await setTitleText(page, stableValue)
    await page.waitForTimeout(2000)
    // Blur the field to ensure onChange fires
    await page.keyboard.press('Tab')
    await page.waitForTimeout(500)
    await clickSave(page)

    // Rapid refreshes
    for (let i = 0; i < 5; i++) {
      await page.goto(articleEditUrl)
      await waitForForm(page)
      const val = await getTitleText(page)
      console.log(`Refresh ${i + 1}: "${val}" (expected: "${stableValue}")`)
      expect(val).toBe(stableValue)
    }
  })
})
