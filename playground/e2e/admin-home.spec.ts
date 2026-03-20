import { test, expect } from '@playwright/test'

test.describe('Admin Home', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
    await page.waitForSelector('text=Welcome back')
  })

  test('renders welcome message', async ({ page }) => {
    await expect(page.locator('text=Welcome back')).toBeVisible()
  })

  test('renders stats', async ({ page }) => {
    await expect(page.locator('text=Total Articles').first()).toBeVisible()
    await expect(page.locator('text=Total Users').first()).toBeVisible()
  })

  test('sidebar navigation works', async ({ page }) => {
    await page.click('text=Tables Demo')
    await page.waitForSelector('h1:text("Table Examples")')
    await expect(page.locator('h1:text("Table Examples")')).toBeVisible()
  })

  test('resource navigation works', async ({ page }) => {
    await page.click('text=Articles')
    await page.waitForTimeout(500)
    expect(page.url()).toContain('/admin/resources/articles')
  })
})
