const { test: baseTest } = require('@playwright/test');

/**
 * Extended test fixture with helper functions
 */
const test = baseTest.extend({
  authenticatedPage: async ({ page }, use) => {
    // Register a test user before each test
    await page.goto('/');
    
    // Check if already logged in
    const authPanel = await page.locator('#auth-panel:visible').count();
    
    if (authPanel > 0) {
      // Register with test credentials
      const testEmail = `test-${Date.now()}@example.com`;
      const testPassword = 'TestPassword123!';
      
      // Click register form tab or switch
      const registerTab = page.locator('text=Register').first();
      if (await registerTab.isVisible()) {
        await registerTab.click();
      }
      
      // Fill register form
      await page.fill('#register-email', testEmail);
      await page.fill('#register-password', testPassword);
      await page.click('button:has-text("Register")');
      
      // Wait for workspace to appear
      await page.waitForSelector('#workspace:visible', { timeout: 10000 });
    }
    
    await use(page);
  }
});

module.exports = { test };
