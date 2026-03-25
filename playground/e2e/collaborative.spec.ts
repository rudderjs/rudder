import { test, expect, type Page } from '@playwright/test'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

/**
 * Collaborative editing tests.
 *
 * Uses a Node.js Yjs client to push changes to the server's Y.Doc room,
 * then verifies via Playwright that the browser renders the correct value.
 *
 * This avoids the Playwright + Lexical limitation where synthetic keyboard
 * events don't trigger Lexical's collaborative update pipeline.
 */

const WS_URL = 'ws://localhost:3000/ws-live'
let articleEditUrl = ''
let resourceDocName = '' // e.g. 'panel:articles:cmn5...'

// ── Helpers ─────────────────────────────────────────────────

async function waitForForm(page: Page) {
  await page.waitForSelector('form', { timeout: 15000 })
  await page.waitForTimeout(8000) // Hydration + WebSocket + CollaborationPlugin
}

async function getTitleText(page: Page): Promise<string> {
  const titleLabel = page.locator('label:has-text("Title")').first()
  const container = titleLabel.locator('..')
  const editor = container.locator('[contenteditable="true"]').first()
  return (await editor.textContent()) ?? ''
}

/**
 * Push text to a per-field Y.Doc room via Node.js WebSocket client.
 * Connects to the room, syncs existing content, modifies the text in the
 * first paragraph node. If the room is empty, this is a no-op (the browser
 * must load first to create the Lexical structure).
 */
function pushToYjsRoom(roomName: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc()
    // @ts-expect-error — y-websocket expects browser WebSocket but works with ws
    const provider = new WebsocketProvider(WS_URL, roomName, doc, { WebSocketPolyfill: WebSocket })

    provider.once('synced', () => {
      const root = doc.get('root', Y.XmlText)

      if (root.length === 0) {
        // Room is empty — can't push without Lexical structure
        console.log(`[pushToYjsRoom] Room ${roomName} is empty — skipping`)
        provider.destroy()
        doc.destroy()
        resolve()
        return
      }

      // Find the paragraph's inner text content and replace it
      // The structure: root (XmlText) → embed (XmlText with __type=paragraph) → text
      // The embed's toDelta shows the actual text inserts
      const delta = root.toDelta()
      doc.transact(() => {
        for (const op of delta) {
          if (op.insert && typeof op.insert !== 'string') {
            const para = op.insert as Y.XmlText
            // Get the paragraph's text delta
            const paraDelta = para.toDelta()
            let offset = 0
            for (const pd of paraDelta) {
              if (typeof pd.insert === 'string') {
                // Delete the existing text and insert new
                para.delete(offset, pd.insert.length)
                para.insert(offset, text)
                console.log(`[pushToYjsRoom] Replaced "${pd.insert}" → "${text}"`)
                break
              }
              offset += typeof pd.insert === 'string' ? pd.insert.length : 1
            }
            break
          }
        }
      })

      setTimeout(() => {
        provider.destroy()
        doc.destroy()
        resolve()
      }, 500)
    })

    setTimeout(() => {
      provider.destroy()
      doc.destroy()
      reject(new Error('Yjs sync timeout'))
    }, 10000)
  })
}

/** Read text from a per-field Y.Doc room via Node.js WebSocket client. */
function readFromYjsRoom(roomName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc()
    // @ts-expect-error — y-websocket expects browser WebSocket
    const provider = new WebsocketProvider(WS_URL, roomName, doc, { WebSocketPolyfill: WebSocket })

    provider.once('synced', () => {
      const root = doc.get('root', Y.XmlText)
      // Extract text from the paragraph embed's delta
      let text = ''
      const delta = root.toDelta()
      for (const op of delta) {
        if (op.insert && typeof op.insert !== 'string') {
          const para = op.insert as Y.XmlText
          const paraDelta = para.toDelta()
          for (const pd of paraDelta) {
            if (typeof pd.insert === 'string') text += pd.insert
          }
        }
      }
      provider.destroy()
      doc.destroy()
      resolve(text.trim())
    })

    setTimeout(() => {
      provider.destroy()
      doc.destroy()
      reject(new Error('Yjs read timeout'))
    }, 10000)
  })
}

// ── Tests ───────────────────────────────────────────────────

test.describe.serial('Collaborative editing', () => {

  test('find article edit URL', async ({ page }) => {
    await page.goto('/admin/resources/articles')
    await page.waitForTimeout(3000)

    // Find an article with a title
    const rows = page.locator('table tbody tr')
    const count = await rows.count()
    for (let i = 0; i < Math.min(count, 5); i++) {
      const cells = rows.nth(i).locator('td')
      const titleCell = await cells.nth(1).textContent()
      if (titleCell && titleCell.trim().length > 0 && titleCell.trim() !== '—') {
        await rows.nth(i).locator('td:last-child a').click()
        break
      }
    }
    await page.waitForTimeout(2000)

    const detailUrl = page.url()
    articleEditUrl = detailUrl + '/edit'

    // Extract resource doc name from URL
    const match = detailUrl.match(/\/resources\/(\w+)\/([^/]+)$/)
    if (match) {
      resourceDocName = `panel:${match[1]}:${match[2]}`
    }
    console.log('Article edit URL:', articleEditUrl)
    console.log('Resource doc name:', resourceDocName)

    // Verify edit page loads
    await page.goto(articleEditUrl)
    await waitForForm(page)
    const title = await getTitleText(page)
    console.log('Current title:', title)
  })

  // ── Test 1: Push via Yjs while browser is open ─────────────

  test('Yjs room update appears in browser (live push)', async ({ page }) => {
    test.skip(!articleEditUrl, 'No article URL')

    // Open the page first — creates the Lexical Y.Doc structure
    await page.goto(articleEditUrl)
    await waitForForm(page)

    const before = await getTitleText(page)
    console.log('Before push:', before)

    // Push new value from Node.js
    const roomName = `${resourceDocName}:text:title`
    const value = `Yjs-${Date.now().toString().slice(-6)}`
    await pushToYjsRoom(roomName, value)
    console.log('Pushed:', value)

    // Wait for sync to propagate to browser
    await page.waitForTimeout(3000)

    const after = await getTitleText(page)
    console.log('After push:', after, 'Expected:', value)
    expect(after).toBe(value)
  })

  // ── Test 2: Two Yjs clients sync ──────────────────────────

  test('Yjs room syncs between Node.js clients', async () => {
    test.skip(!resourceDocName, 'No resource doc name')

    const roomName = `${resourceDocName}:text:title`
    const value = `Sync-${Date.now().toString().slice(-6)}`

    // Client 1 pushes
    await pushToYjsRoom(roomName, value)

    // Client 2 reads
    const read = await readFromYjsRoom(roomName)
    console.log('Client 2 reads:', read, 'Expected:', value)
    expect(read).toBe(value)
  })

  // ── Test 3: Push, browser refresh, still shows value ──────

  test('Yjs value persists across browser refresh', async ({ page }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const roomName = `${resourceDocName}:text:title`
    const value = `Persist-${Date.now().toString().slice(-6)}`

    await pushToYjsRoom(roomName, value)

    // First load
    await page.goto(articleEditUrl)
    await waitForForm(page)
    const first = await getTitleText(page)
    console.log('First load:', first)
    expect(first).toBe(value)

    // Refresh
    await page.goto(articleEditUrl)
    await waitForForm(page)
    const second = await getTitleText(page)
    console.log('After refresh:', second)
    expect(second).toBe(value)
  })

  // ── Test 4: Two browsers see the same Yjs value ───────────

  test('two browsers both see Yjs room value', async ({ browser }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const roomName = `${resourceDocName}:text:title`
    const value = `Both-${Date.now().toString().slice(-6)}`

    await pushToYjsRoom(roomName, value)

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await page1.goto(articleEditUrl)
      await page2.goto(articleEditUrl)
      await waitForForm(page1)
      await waitForForm(page2)

      const val1 = await getTitleText(page1)
      const val2 = await getTitleText(page2)
      console.log('User1:', val1, 'User2:', val2, 'Expected:', value)
      expect(val1).toBe(value)
      expect(val2).toBe(value)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // ── Test 5: Push from Node.js while browser is open ───────

  test('live update: push while browser is open', async ({ page }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const roomName = `${resourceDocName}:text:title`

    await page.goto(articleEditUrl)
    await waitForForm(page)

    const before = await getTitleText(page)
    console.log('Before push:', before)

    // Push a new value while the page is open
    const value = `Live-${Date.now().toString().slice(-6)}`
    await pushToYjsRoom(roomName, value)

    // Wait for sync to propagate to browser
    await page.waitForTimeout(3000)

    const after = await getTitleText(page)
    console.log('After push:', after, 'Expected:', value)
    expect(after).toBe(value)
  })

  // ── Test 6: Push, second browser opens, sees value, refreshes ─

  test('unsaved edit visible to second user and survives refresh', async ({ browser }) => {
    test.skip(!articleEditUrl, 'No article URL')

    const roomName = `${resourceDocName}:text:title`
    const value = `Draft-${Date.now().toString().slice(-6)}`

    // Simulate User A editing by pushing to Yjs room
    await pushToYjsRoom(roomName, value)

    const ctx = await browser.newContext()
    const page2 = await ctx.newPage()

    try {
      // User B opens — should see the value
      await page2.goto(articleEditUrl)
      await waitForForm(page2)
      const first = await getTitleText(page2)
      console.log('B first load:', first, 'Expected:', value)
      expect(first).toBe(value)

      // User B refreshes — should still see it
      await page2.goto(articleEditUrl)
      await waitForForm(page2)
      const second = await getTitleText(page2)
      console.log('B after refresh:', second, 'Expected:', value)
      expect(second).toBe(value)
    } finally {
      await ctx.close()
    }
  })
})
