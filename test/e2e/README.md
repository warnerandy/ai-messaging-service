# E2E Testing Guide

This project includes comprehensive end-to-end (E2E) tests using Playwright.

## Setup

### Prerequisites
- Node.js 16+ installed
- Phoenix server running on localhost:4000
- Database with migrations applied

### Installation

```bash
npm install
```

This installs Playwright and the necessary browser binaries.

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in UI mode (interactive)
```bash
npm run test:ui
```

### Run tests in headed mode (see browser)
```bash
npm run test:headed
```

### Debug tests
```bash
npm run test:debug
```

### Run specific test file
```bash
npx playwright test test/e2e/auth.spec.js
```

### Run tests matching a pattern
```bash
npx playwright test -g "can send message"
```

## Test Structure

- `test/e2e/auth.spec.js` - Authentication and basic user flows
- `test/e2e/fixtures.js` - Shared test fixtures and helpers

## Test Scenarios

The test suite covers:

1. **User Registration & Login**
   - Register new user with email/password
   - Login with registered credentials
   - Logout functionality

2. **Bot Management**
   - View bot list
   - Empty state when no bots exist
   - Bot status display (online/offline, thinking)

3. **Conversations**
   - Create conversation
   - View conversation history
   - Select different conversations

4. **Messaging**
   - Send messages (optimistic display)
   - Pending state indication
   - Message history display
   - Model selection before sending

5. **Real-time Features**
   - WebSocket connection
   - Receive messages in real-time
   - Bot typing indicator
   - Bot status updates

6. **Notifications**
   - Request notification permission
   - Show notification when backgrounded
   - Notification settings

## Writing New Tests

### Basic Test Template

```javascript
const { test, expect } = require('@playwright/test');

test('descriptive test name', async ({ page }) => {
  // Navigate
  await page.goto('/');

  // Interact
  await page.fill('#email', 'test@example.com');
  await page.click('button:has-text("Login")');

  // Assert
  await expect(page.locator('#workspace')).toBeVisible();
});
```

### Using Fixtures

```javascript
const { test, expect } = require('@playwright/test');
const { test: authenticatedTest } = require('./fixtures');

authenticatedTest('authenticated user test', async ({ authenticatedPage }) => {
  // authenticatedPage is already logged in
  await expect(authenticatedPage.locator('#workspace')).toBeVisible();
});
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Install dependencies
  run: npm install

- name: Install Playwright browsers
  run: npx playwright install --with-deps

- name: Start server
  run: mix phx.server &

- name: Run E2E tests
  run: npm test
```

## Troubleshooting

### Port Already in Use
```bash
lsof -ti:4000 | xargs kill -9
```

### Browser Issues
```bash
npx playwright install --with-deps
```

### Test Timing Issues
- Increase timeout: `await page.waitForSelector('#element', { timeout: 20000 })`
- Wait for conditions: `await page.waitForLoadState('networkidle')`

## Best Practices

1. **Use data attributes** for selecting elements in tests
   ```html
   <button data-testid="send-btn">Send</button>
   ```
   ```javascript
   await page.click('[data-testid="send-btn"]')
   ```

2. **Wait for elements** rather than using fixed delays
   ```javascript
   // Good
   await expect(page.locator('#message')).toBeVisible({ timeout: 5000 });
   
   // Bad
   await page.waitForTimeout(1000);
   ```

3. **Use meaningful assertions**
   ```javascript
   // Good
   await expect(page.locator('text=Hello bot')).toBeVisible();
   
   // Vague
   expect(html).toContain('Hello');
   ```

4. **Isolate tests** - Each test should be independent

5. **Use test hooks** for setup/cleanup
   ```javascript
   test.beforeEach(async ({ page }) => {
     await page.goto('/');
   });
   ```

## Debugging

### View Test Report
```bash
npm test
# Then open playwright-report/index.html
```

### Slow Motion
```bash
npx playwright test --headed --config playwright.config.js
```

### Inspect Element
```bash
npx playwright test --debug
```

## Performance Tips

- Run tests in parallel (default)
- Use `fullyParallel: false` if tests conflict
- Run only affected tests during development
- Use `test.only()` for focused testing (remove before commit!)

## Resources

- [Playwright Docs](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Selectors Guide](https://playwright.dev/docs/locators)
