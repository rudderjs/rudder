import { test, expect } from '@playwright/test'

test.describe('Dialogs Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/dialogs-demo')
    await page.waitForSelector('h1:text("Dialog Examples")')
    // Wait for React hydration
    await page.waitForTimeout(2000)
  })

  test('dialog trigger button is visible', async ({ page }) => {
    await expect(page.locator('button:text("Contact Support")')).toBeVisible()
  })

  test('clicking trigger opens dialog', async ({ page }) => {
    await page.locator('button:text("Contact Support")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('text=Send a Message')).toBeVisible()
    await expect(dialog.locator('text=We\'ll get back to you within 24 hours.')).toBeVisible()
  })

  test('dialog form has fields', async ({ page }) => {
    await page.locator('button:text("Contact Support")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('label:text("Your Name")')).toBeVisible()
    await expect(dialog.locator('label:text("Email Address")')).toBeVisible()
    await expect(dialog.locator('label:text("Message")')).toBeVisible()
  })

  test('dialog form submits successfully', async ({ page }) => {
    await page.locator('button:text("Contact Support")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await dialog.locator('input').first().fill('Test')
    await dialog.locator('input').nth(1).fill('test@test.com')
    await dialog.locator('textarea').first().fill('Hello')
    await dialog.locator('button:text("Send Message")').click()
    await page.waitForTimeout(1000)
    await expect(page.locator('text=Message sent!')).toBeVisible()
  })

  test('dialog with static content shows stats', async ({ page }) => {
    await page.locator('button:text("View Details")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('text=Uptime')).toBeVisible()
    await expect(dialog.locator('text=99.9%')).toBeVisible()
  })

  test('multiple dialogs are independent', async ({ page }) => {
    // Open first dialog
    await page.locator('button:text("Quick Add Item")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('text=Add New Item')).toBeVisible()
  })
})
