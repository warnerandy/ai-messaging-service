const { test, expect } = require('@playwright/test');

test.describe('Suggestion Visual Preview', () => {
  test('renders idle and selected suggestion chip states', async ({ page }) => {
    await page.goto('/suggestion-preview.html');

    const preview = page.locator('[data-testid="suggestion-preview-page"]');
    await expect(preview).toBeVisible();

    await expect(page.locator('.msg-suggestions').first()).toBeVisible();
    await expect(page.locator('.suggestion-chip')).toHaveCount(6);
    await expect(page.locator('.suggestion-chip--used')).toHaveCount(1);
    await expect(page.locator('.suggestion-chip--dismissed')).toHaveCount(2);

    await expect(page.locator('[data-testid="suggestion-preview-messages"]')).toHaveScreenshot('suggestion-preview-messages.png');
  });
});
