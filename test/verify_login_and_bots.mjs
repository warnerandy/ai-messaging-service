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

	// Click on Atlas Coding Agent
	const atlasPill = page.locator(".bot-pill", { hasText: "Atlas Coding Agent" })
	await atlasPill.click()
	await page.waitForTimeout(1000)

	const html = await page.content()
	console.log("Has AHP Protocol badge:", html.includes("AHP Protocol"))
	console.log("Has Fix token revocation session:", html.includes("Fix token revocation in UserAuth"))
	console.log("Has Database Migration session:", html.includes("Database Migration for Bot Token Index"))
	console.log("Has Add AHP Protocol Badge session:", html.includes("Add AHP Protocol Badge to Chat UI"))

	// Click on the Database Migration session (Needs Input)
	const migrateSession = page.locator(".conv-item", { hasText: "Database Migration" })
	if (await migrateSession.count() > 0) {
		await migrateSession.click()
		await page.waitForTimeout(1000)
		const sessionHtml = await page.content()
		console.log("Has Action Approval card:", sessionHtml.includes("Action Approval Required") || sessionHtml.includes("Approve Migration"))
	}

	await browser.close()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
