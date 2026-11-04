/**
 * Lightweight, zero-Elixir-dependency WebSocket Channel client compatible with
 * the `aims-server` Rust WebSocket hub (`/socket/websocket`) and `phoenix` Socket API.
 */

class Push {
	constructor(channel, event, payload) {
		this.channel = channel
		this.event = event
		this.payload = payload || {}
		this.ref = null
		this.recHooks = []
		this.receivedResp = null
	}

	receive(status, callback) {
		if (this.receivedResp && this.receivedResp.status === status) {
			callback(this.receivedResp.response)
		}
		this.recHooks.push({ status, callback })
		return this
	}

	trigger(status, response) {
		this.receivedResp = { status, response }
		this.recHooks
			.filter((h) => h.status === status)
			.forEach((h) => {
				try {
					h.callback(response)
				} catch (err) {
					console.error("Push callback error:", err)
				}
			})
	}
}

export class Channel {
	constructor(topic, params, socket) {
		this.topic = topic
		this.params = params || {}
		this.socket = socket
		this.bindings = []
		this.state = "closed"
		this.joinPush = new Push(this, "phx_join", this.params)
		this.joinRef = null
	}

	on(event, callback) {
		this.bindings.push({ event, callback })
		return this.bindings.length
	}

	off(event) {
		this.bindings = this.bindings.filter((b) => b.event !== event)
	}

	join() {
		this.state = "joining"
		this.joinRef = this.socket.makeRef()
		this.joinPush.ref = this.joinRef
		this.socket.sendFrame({
			join_ref: this.joinRef,
			ref: this.joinRef,
			topic: this.topic,
			event: "phx_join",
			payload: this.params,
		})
		return this.joinPush
	}

	push(event, payload = {}) {
		const pushEvent = new Push(this, event, payload)
		const ref = this.socket.makeRef()
		pushEvent.ref = ref
		this.socket.pendingPushes.set(ref, pushEvent)
		this.socket.sendFrame({
			join_ref: this.joinRef,
			ref,
			topic: this.topic,
			event,
			payload,
		})
		return pushEvent
	}

	leave() {
		this.state = "leaving"
		const ref = this.socket.makeRef()
		this.socket.sendFrame({
			join_ref: this.joinRef,
			ref,
			topic: this.topic,
			event: "phx_leave",
			payload: {},
		})
		this.state = "closed"
		this.socket.removeChannel(this)
	}

	handleMessage(event, payload, ref) {
		if (event === "phx_reply") {
			const status = payload?.status || "ok"
			const response = payload?.response || {}
			if (ref && ref === this.joinRef) {
				this.state = status === "ok" ? "joined" : "errored"
				this.joinPush.trigger(status, response)
				return
			}
			const pending = ref ? this.socket.pendingPushes.get(ref) : null
			if (pending) {
				this.socket.pendingPushes.delete(ref)
				pending.trigger(status, response)
				return
			}
		}

		this.bindings
			.filter((b) => b.event === event)
			.forEach((b) => {
				try {
					b.callback(payload)
				} catch (err) {
					console.error(`Channel handler error on ${this.topic}:${event}`, err)
				}
			})
	}
}

export class Socket {
	constructor(endPoint, opts = {}) {
		this.endPoint = endPoint
		this.params = opts.params || {}
		this.ws = null
		this.refCounter = 0
		this.channels = []
		this.pendingPushes = new Map()
		this.sendBuffer = []
		this.heartbeatTimer = null
		this.reconnectTimer = null
		this.intentionallyClosed = false
	}

	makeRef() {
		this.refCounter += 1
		return String(this.refCounter)
	}

	endPointURL() {
		const protocol =
			typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:"
		const host = typeof window !== "undefined" ? window.location.host : "localhost:4000"
		const basePath = this.endPoint.endsWith("/websocket")
			? this.endPoint
			: `${this.endPoint}/websocket`
		const search = new URLSearchParams({
			...this.params,
			vsn: "2.0.0",
		})
		return `${protocol}//${host}${basePath}?${search.toString()}`
	}

	connect() {
		this.intentionallyClosed = false
		if (typeof WebSocket === "undefined") return

		try {
			this.ws = new WebSocket(this.endPointURL())
		} catch {
			return
		}

		this.ws.onopen = () => {
			this.flushSendBuffer()
			this.startHeartbeat()
		}

		this.ws.onmessage = (evt) => {
			try {
				const parsed = JSON.parse(evt.data)
				let joinRef = null
				let ref = null
				let topic = ""
				let event = ""
				let payload = {}

				if (Array.isArray(parsed) && parsed.length >= 5) {
					;[joinRef, ref, topic, event, payload] = parsed
				} else if (parsed && typeof parsed === "object") {
					joinRef = parsed.join_ref
					ref = parsed.ref
					topic = parsed.topic
					event = parsed.event
					payload = parsed.payload || {}
				}

				if (!topic) return
				this.channels
					.filter((ch) => ch.topic === topic && (!joinRef || !ch.joinRef || ch.joinRef === joinRef))
					.forEach((ch) => ch.handleMessage(event, payload, ref))
			} catch (err) {
				console.error("Failed to parse WebSocket frame:", err)
			}
		}

		this.ws.onclose = () => {
			this.stopHeartbeat()
			if (!this.intentionallyClosed) {
				this.reconnectTimer = setTimeout(() => {
					this.connect()
					this.channels.forEach((ch) => {
						if (ch.state === "joined" || ch.state === "joining") {
							ch.join()
						}
					})
				}, 2000)
			}
		}
	}

	disconnect() {
		this.intentionallyClosed = true
		this.stopHeartbeat()
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.ws) {
			try {
				this.ws.close()
			} catch {
				// ignore
			}
			this.ws = null
		}
	}

	channel(topic, chanParams = {}) {
		const ch = new Channel(topic, chanParams, this)
		this.channels.push(ch)
		return ch
	}

	removeChannel(ch) {
		this.channels = this.channels.filter((c) => c !== ch)
	}

	sendFrame({ join_ref, ref, topic, event, payload }) {
		const raw = JSON.stringify([join_ref ?? null, ref ?? null, topic, event, payload ?? {}])
		if (this.ws && this.ws.readyState === 1) {
			this.ws.send(raw)
		} else {
			this.sendBuffer.push(raw)
		}
	}

	flushSendBuffer() {
		if (!this.ws || this.ws.readyState !== 1) return
		while (this.sendBuffer.length > 0) {
			const msg = this.sendBuffer.shift()
			this.ws.send(msg)
		}
	}

	startHeartbeat() {
		this.stopHeartbeat()
		this.heartbeatTimer = setInterval(() => {
			if (this.ws && this.ws.readyState === 1) {
				this.sendFrame({
					join_ref: null,
					ref: this.makeRef(),
					topic: "phoenix",
					event: "heartbeat",
					payload: {},
				})
			}
		}, 30000)
	}

	stopHeartbeat() {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = null
		}
	}
}
