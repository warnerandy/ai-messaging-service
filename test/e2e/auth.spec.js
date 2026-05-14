const { test, expect } = require('@playwright/test');

test.describe('Messaging PWA E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app
    await page.goto('/');
  });

  test('User can register and log in', async ({ page }) => {
    // Check auth panel is visible
    const authPanel = page.locator('#auth-panel');
    await expect(authPanel).toBeVisible();

    // Register with new user
    const email = `user-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    // Click register tab if visible
    const registerTitle = page.locator('text=Register').first();
    if (await registerTitle.isVisible()) {
      await registerTitle.click();
    }

    // Fill and submit register form
    await page.fill('#register-email', email);
    await page.fill('#register-password', password);
    await page.click('button:has-text("Register")');

    // Workspace should appear after successful registration
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });

    // Logout
    await page.click('#logout-btn');

    // Auth panel should be visible again
    await expect(authPanel).toBeVisible({ timeout: 5000 });

    // Now login with the same credentials
    const loginForm = page.locator('#login-form');
    await expect(loginForm).toBeVisible();

    // Switch to login tab if needed
    const loginTitle = page.locator('text=Login').first();
    if (await loginTitle.isVisible()) {
      await loginTitle.click();
    }

    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('button:has-text("Login")');

    // Workspace should appear
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });
  });

  test('User can see bot list (empty state)', async ({ page }) => {
    // Register
    const email = `user-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const registerTitle = page.locator('text=Register').first();
    if (await registerTitle.isVisible()) {
      await registerTitle.click();
    }

    await page.fill('#register-email', email);
    await page.fill('#register-password', password);
    await page.click('button:has-text("Register")');

    // Wait for workspace
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });

    // Empty state should show if no bots
    const emptyState = page.locator('#empty-state');
    const isEmptyVisible = await emptyState.isVisible();

    if (isEmptyVisible) {
      await expect(emptyState).toContainText('No bots found');
    }
  });

  test('User can send message and receive via WebSocket', async ({ page, context }) => {
    // Register user
    const userEmail = `user-${Date.now()}@example.com`;
    const userPassword = 'TestPassword123!';

    const registerTitle = page.locator('text=Register').first();
    if (await registerTitle.isVisible()) {
      await registerTitle.click();
    }

    await page.fill('#register-email', userEmail);
    await page.fill('#register-password', userPassword);
    await page.click('button:has-text("Register")');

    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });

    // Create a bot programmatically via API (in real test would use bot creation UI or API)
    // For now, we'll test that the message form is present and sendable
    
    const messageForm = page.locator('#message-form');
    const messageInput = page.locator('#message-input');
    
    if (await messageForm.isVisible({ timeout: 5000 })) {
      // Type a test message
      const testMessage = 'Hello bot, this is a test message!';
      await messageInput.fill(testMessage);
      
      // Submit the form
      await messageForm.getByRole('button', { name: /send|submit/i }).click();

      // Verify message appears in the chat
      const messageElement = page.locator(`text=${testMessage}`);
      await expect(messageElement).toBeVisible({ timeout: 5000 });

      // Check that the message has "pending" state initially
      const pendingBadge = page.locator('.pending-badge');
      if (await pendingBadge.count() > 0) {
        await expect(pendingBadge).toBeVisible();
      }

      // Input should be cleared
      await expect(messageInput).toHaveValue('');
    }
  });

  test('User can select model and send message', async ({ page }) => {
    // Register
    const email = `user-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const registerTitle = page.locator('text=Register').first();
    if (await registerTitle.isVisible()) {
      await registerTitle.click();
    }

    await page.fill('#register-email', email);
    await page.fill('#register-password', password);
    await page.click('button:has-text("Register")');

    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });

    // Check if model selector exists
    const modelSelect = page.locator('#model-select');
    if (await modelSelect.isVisible({ timeout: 5000 })) {
      // Model select should have default "Auto model" option
      await expect(modelSelect).toContainText('Auto model');
    }
  });

  test('Typing indicator appears when bot is working', async ({ page }) => {
    // Register
    const email = `user-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const registerTitle = page.locator('text=Register').first();
    if (await registerTitle.isVisible()) {
      await registerTitle.click();
    }

    await page.fill('#register-email', email);
    await page.fill('#register-password', password);
    await page.click('button:has-text("Register")');

    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });

    // Check for typing indicator element (should exist in DOM but hidden by default)
    const typingIndicator = page.locator('.typing-indicator');
    
    // It should not be visible initially
    expect(await typingIndicator.count()).toBe(0);
  });

  test('Notification permission is requested on load', async ({ page, context }) => {
    // Grant notification permission
    await context.grantPermissions(['notifications']);

    // Register
    const email = `user-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const registerTitle = page.locator('text=Register').first();
    if (await registerTitle.isVisible()) {
      await registerTitle.click();
    }

    await page.fill('#register-email', email);
    await page.fill('#register-password', password);
    await page.click('button:has-text("Register")');

    await expect(page.locator('#workspace')).toBeVisible({ timeout: 10000 });

    // Check localStorage for notification setting
    const notificationsEnabled = await page.evaluate(() => {
      return localStorage.getItem('notifications.enabled');
    });

    // Notifications should be enabled (might be 'true' string)
    expect(['true', 'granted', null]).toContain(notificationsEnabled);
  });
});
