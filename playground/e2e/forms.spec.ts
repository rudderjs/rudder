import { test, expect } from '@playwright/test'

test.describe('Forms Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/forms-demo')
    await page.waitForSelector('h1:text("Form & Dialog Examples")')
    // Wait for React hydration
    await page.waitForTimeout(2000)
  })

  // ── Simple form ─────────────────────────────────────────────

  test('simple form renders fields', async ({ page }) => {
    await expect(page.locator('label:text("Your Name")').first()).toBeVisible()
    await expect(page.locator('label:text("Email Address")').first()).toBeVisible()
    await expect(page.locator('label:text("Message")').first()).toBeVisible()
  })

  test('simple form requires fields', async ({ page }) => {
    // Click submit without filling — should not show success
    await page.click('button:text("Send Message")')
    await page.waitForTimeout(300)
    // Success message should NOT appear
    const success = page.locator('text=Message sent!')
    await expect(success).not.toBeVisible()
  })

  test('simple form submits successfully', async ({ page }) => {
    // Scope to the first form (contact form)
    const form = page.locator('form').first()
    await form.locator('input').first().fill('Test User')
    await form.locator('input').nth(1).fill('test@example.com')
    await form.locator('textarea').first().fill('Hello world')
    await page.click('button:text("Send Message")')
    await page.waitForTimeout(1000)
    await expect(page.locator('text=Message sent!').first()).toBeVisible()
  })

  // ── Form with sections ─────────────────────────────────────

  test('form with sections renders heading', async ({ page }) => {
    // The section title "Form with Sections" is rendered as an h2
    await expect(page.locator('h2:text("Form with Sections")')).toBeVisible()
    await expect(page.locator('text=Fields grouped into sections inside a form.')).toBeVisible()
  })

  // ── Pre-populated form ─────────────────────────────────────

  test('pre-populated form has initial values', async ({ page }) => {
    // The prefilled form has a Name input with value "John Doe"
    // React-controlled inputs use .value not attribute, so use toHaveValue()
    const prefillHeading = page.locator('h2:text("Pre-populated Form")')
    await expect(prefillHeading).toBeVisible()
    // Find the form card after the "Pre-populated Form" heading
    // The prefilled form's Name input
    const nameInput = page.locator('form').nth(2).locator('input').first()
    await expect(nameInput).toHaveValue('John Doe')
  })

  // ── Dialog ──────────────────────────────────────────────────

  test('dialog opens on trigger click', async ({ page }) => {
    await page.locator('button:text("Open Feedback Form")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('text=Send Feedback').first()).toBeVisible()
    await expect(dialog.locator('text=We read every submission.')).toBeVisible()
  })

  test('dialog form submits and shows success', async ({ page }) => {
    await page.locator('button:text("Open Feedback Form")').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    const dialog = page.locator('[role="dialog"]')
    await dialog.locator('input').first().fill('Test Subject')
    await dialog.locator('textarea').first().fill('Test feedback')
    await dialog.locator('button:text("Send Feedback")').click()
    await page.waitForTimeout(1000)
    await expect(page.locator('text=Thank you for your feedback!')).toBeVisible()
  })
})
