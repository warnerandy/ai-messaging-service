export async function apiRequest(path, { method = "GET", body, token } = {}) {
	const headers = { "Content-Type": "application/json" }
	if (token) headers.Authorization = `Bearer ${token}`

	const res = await fetch(path, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
		cache: "no-store",
	})
	const json = await res.json().catch(() => ({}))
	if (!res.ok) {
		if (json.errors) {
			const errorMsg = Object.entries(json.errors)
				.map(([field, msgs]) => `${field} ${msgs.join(", ")}`)
				.join("; ")
			throw new Error(errorMsg)
		}
		throw new Error(json.error || "Request failed")
	}
	return json
}

export async function uploadFile(path, file, token) {
	const formData = new FormData()
	formData.append("file", file)

	const headers = {}
	if (token) headers.Authorization = `Bearer ${token}`

	const res = await fetch(path, {
		method: "POST",
		body: formData,
		headers,
	})

	const json = await res.json().catch(() => ({}))
	if (!res.ok) throw new Error(json.error || res.statusText || "Upload failed")
	return json
}
