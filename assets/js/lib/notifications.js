export function registerServiceWorker() {
	if ("serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("/sw.js").catch(() => {})
		})
	}
}

export function requestNotificationPermission() {
	if ("Notification" in window && Notification.permission === "default") {
		Notification.requestPermission()
	}
}

export function showNotificationIfBackgrounded(message) {
	if (!("serviceWorker" in navigator) || !document.hidden) return
	if (message.role !== "bot") return
	navigator.serviceWorker.getRegistration().then((reg) => {
		if (reg) {
			reg.showNotification("New message from bot", {
				body: message.body || "You have a new message",
				tag: "bot-message",
				requireInteraction: false,
			})
		}
	})
}
