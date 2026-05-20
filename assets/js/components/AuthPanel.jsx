import React, { useState } from "react"
import { Spinner } from "@heroui/react"
import { loginUser, registerUser } from "../lib/data.js"

export default function AuthPanel({ onAuth }) {
	const [mode, setMode] = useState("login")
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)

	async function handleSubmit(event) {
		event.preventDefault()
		setError("")
		setLoading(true)

		try {
			const response =
				mode === "login" ? await loginUser(email, password) : await registerUser(email, password)

			onAuth(response)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const isLogin = mode === "login"

	return (
		<div id="auth-panel" className="auth-container">
			<div className="auth-glow" />
			<div className="auth-card">
				<div className="auth-logo">
					<svg width="40" height="40" viewBox="0 0 40 40" fill="none">
						<rect width="40" height="40" rx="12" fill="#2489ff" fillOpacity="0.15" />
						<path
							d="M12 16a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2h-3l-3 3-3-3h-3a2 2 0 01-2-2v-6z"
							stroke="#2489ff"
							strokeWidth="1.5"
							fill="none"
						/>
						<circle cx="17" cy="19" r="1.25" fill="#2489ff" />
						<circle cx="23" cy="19" r="1.25" fill="#2489ff" />
					</svg>
				</div>

				<h1 className="auth-title">{isLogin ? "Welcome back" : "Create your account"}</h1>
				<p className="auth-subtitle">
					{isLogin
						? "Sign in to manage your bots and conversations"
						: "Get started with your messaging workspace"}
				</p>

				<div className="auth-switcher" aria-label="Authentication mode">
					<a
						href="#login"
						role="button"
						className={["auth-switcher-tab", isLogin && "auth-switcher-tab--active"]
							.filter(Boolean)
							.join(" ")}
						onClick={(event) => {
							event.preventDefault()
							setMode("login")
							setError("")
						}}
					>
						Login
					</a>
					<a
						href="#register"
						role="button"
						className={["auth-switcher-tab", !isLogin && "auth-switcher-tab--active"]
							.filter(Boolean)
							.join(" ")}
						onClick={(event) => {
							event.preventDefault()
							setMode("register")
							setError("")
						}}
					>
						Register
					</a>
				</div>

				{isLogin ? (
					<form id="login-form" onSubmit={handleSubmit} className="auth-form">
						<div className="form-fields">
							<div className="field-group">
								<label className="field-label" htmlFor="login-email">
									Email
								</label>
								<input
									id="login-email"
									type="email"
									className="field-input"
									placeholder="you@example.com"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									required
									autoComplete="email"
								/>
							</div>
							<div className="field-group">
								<label className="field-label" htmlFor="login-password">
									Password
								</label>
								<input
									id="login-password"
									type="password"
									className="field-input"
									placeholder="••••••••"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									required
									autoComplete="current-password"
								/>
							</div>
						</div>

						{error && (
							<div id="auth-error" className="form-error">
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
									<circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
									<path
										d="M8 4.5v4M8 10.5v.5"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
									/>
								</svg>
								{error}
							</div>
						)}

						<button type="submit" className="auth-submit" disabled={loading}>
							{loading && <Spinner size="sm" />}
							Login
						</button>
					</form>
				) : (
					<form id="register-form" onSubmit={handleSubmit} className="auth-form">
						<div className="form-fields">
							<div className="field-group">
								<label className="field-label" htmlFor="register-email">
									Email
								</label>
								<input
									id="register-email"
									type="email"
									className="field-input"
									placeholder="you@example.com"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									required
									autoComplete="email"
								/>
							</div>
							<div className="field-group">
								<label className="field-label" htmlFor="register-password">
									Password
								</label>
								<input
									id="register-password"
									type="password"
									className="field-input"
									placeholder="••••••••"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									required
									autoComplete="new-password"
								/>
							</div>
						</div>

						{error && (
							<div id="auth-error" className="form-error">
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
									<circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
									<path
										d="M8 4.5v4M8 10.5v.5"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
									/>
								</svg>
								{error}
							</div>
						)}

						<button type="submit" className="auth-submit" disabled={loading}>
							{loading && <Spinner size="sm" />}
							Register
						</button>
					</form>
				)}
			</div>
		</div>
	)
}
