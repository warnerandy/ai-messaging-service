import { chromium } from "@playwright/test"

async function main() {
	const browser = await chromium.launch({ channel: "chrome" })
	const page = await browser.newPage()
	await page.goto("http://localhost:4002")
	await page.waitForSelector("#login-email")
	await page.fill("#login-email", "tester@example.com")
	await page.fill("#login-password", "TestPassword123!")
	await page.click('button[type="submit"]')
	await page.waitForSelector(".bot-pill", { timeout: 10000 })

	const atlas = page.locator(".bot-pill", { hasText: "Atlas Coding Agent" })
	await atlas.click()
	await page.waitForTimeout(1000)

	const atlasItems = await page.$$eval(".conv-item", (els) =>
		els.map((el) => ({
			title: el.querySelector(".conv-title")?.textContent?.trim(),
			time: el.querySelector(".conv-time")?.textContent?.trim(),
			step: el.querySelector(".conv-step-preview")?.textContent?.trim(),
			hasTopRow: Boolean(el.querySelector(".conv-row--top")),
			hasBottomRow: Boolean(el.querySelector(".conv-row--bottom")),
			height: el.clientHeight,
		})),
	)
	console.log("Atlas 2-row sessions:", atlasItems)

	const sidebar = page.locator(".sidebar")
	await sidebar.screenshot({ path: "test-results/sidebar-atlas.png" })

	const claude = page.locator(".bot-pill", { hasText: "Claude 3.7 Sonnet" })
	await claude.click()
	await page.waitForTimeout(1000)

	const claudeItems = await page.$$eval(".conv-item", (els) =>
		els.map((el) => ({
			title: el.querySelector(".conv-title")?.textContent?.trim(),
			time: el.querySelector(".conv-time")?.textContent?.trim(),
		})),
	)
	console.log("Claude sessions:", claudeItems)

	await sidebar.screenshot({ path: "test-results/sidebar-current.png" })

	await browser.close()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
