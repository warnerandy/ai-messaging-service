const { test, expect } = require('@playwright/test');

test.describe('Verify Login Page', () => {
  test('https://aims.thebitvoid.dev should show login page', async ({ page }) => {
    // Navigate to the URL
    await page.goto('https://aims.thebitvoid.dev', { waitUntil: 'domcontentloaded' });
    
    // Wait a bit for JavaScript to render
    await page.waitForTimeout(2000);
    
    // Check for auth panel
    const authPanel = await page.locator('#auth-panel').count();
    
    // Check for login elements
    const loginElements = await page.locator('text=/Login|Sign in/i').count();
    
    console.log('Auth panel elements found:', authPanel);
    console.log('Login text elements found:', loginElements);
    
    // Get page content for debugging
    const title = await page.title();
    const bodyText = await page.innerText('body').catch(() => 'Could not get text');
    
    console.log('Page title:', title);
    console.log('Body text preview:', bodyText.substring(0, 300));
    
    // Verify some login-related content exists
    expect(authPanel + loginElements).toBeGreaterThanOrEqual(1);
  });
});
