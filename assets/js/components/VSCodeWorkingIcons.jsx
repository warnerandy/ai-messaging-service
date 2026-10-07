import React from "react"

/**
 * Visual Studio Code Working State Icons & Animations
 *
 * Implements authentic VS Code Codicon SVGs, spinning animation mechanics
 * (both native `steps(30)` and smooth `linear`), AI Copilot sparkle breathing,
 * sonar pulse rings, and the indeterminate progress bar runner.
 */

// 1. VS Code Loading Spinner ($(loading~spin))
export function VSCodeLoadingIcon({
	size = 16,
	spin = true,
	smooth = false,
	className = "",
	color,
	ariaLabel = "Loading",
}) {
	const spinClass = spin ? (smooth ? "vscode-spin-smooth" : "vscode-spin") : ""
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={`vscode-icon vscode-codicon-loading ${spinClass} ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<path d="M13.5 8.5C13.224 8.5 13 8.276 13 8C13 5.243 10.757 3 8 3C5.243 3 3 5.243 3 8C3 8.276 2.776 8.5 2.5 8.5C2.224 8.5 2 8.276 2 8C2 4.691 4.691 2 8 2C11.309 2 14 4.691 14 8C14 8.276 13.776 8.5 13.5 8.5Z" />
		</svg>
	)
}

// 2. VS Code Sync Spinner ($(sync~spin))
export function VSCodeSyncIcon({
	size = 16,
	spin = true,
	smooth = false,
	className = "",
	color,
	ariaLabel = "Syncing",
}) {
	const spinClass = spin ? (smooth ? "vscode-spin-smooth" : "vscode-spin") : ""
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={`vscode-icon vscode-codicon-sync ${spinClass} ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<path d="M14 3.5V6.5C14 6.78 13.78 7 13.5 7H10.5C10.22 7 9.99999 6.78 9.99999 6.5C9.99999 6.22 10.22 6 10.5 6H12.58C11.78 4.17 10.01 3 7.99999 3C5.77999 3 3.79999 4.5 3.18999 6.64C3.12999 6.86 2.92999 7 2.70999 7C2.65999 7 2.61999 7 2.56999 6.98C2.29999 6.9 2.14999 6.63 2.22999 6.36C2.95999 3.79 5.32999 2 7.99999 2C10.05 2 11.91 3.02 13 4.69V3.5C13 3.22 13.22 3 13.5 3C13.78 3 14 3.22 14 3.5ZM13.42 9.02C13.16 8.95 12.88 9.1 12.8 9.37C12.19 11.51 10.22 13.01 7.98999 13.01C5.97999 13.01 4.20999 11.84 3.40999 10.01H5.48999C5.76999 10.01 5.98999 9.79 5.98999 9.51C5.98999 9.23 5.76999 9.01 5.48999 9.01H2.48999C2.20999 9.01 1.98999 9.23 1.98999 9.51V12.51C1.98999 12.79 2.20999 13.01 2.48999 13.01C2.76999 13.01 2.98999 12.79 2.98999 12.51V11.32C4.07999 12.98 5.93999 14.01 7.98999 14.01C10.66 14.01 13.03 12.22 13.76 9.65C13.84 9.38 13.68 9.11 13.41 9.03L13.42 9.02Z" />
		</svg>
	)
}

// 3. VS Code Gear / Tool Runner ($(gear~spin))
export function VSCodeGearIcon({
	size = 16,
	spin = true,
	className = "",
	color,
	ariaLabel = "Executing tool",
}) {
	const spinClass = spin ? "vscode-spin-slow" : ""
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={`vscode-icon vscode-codicon-gear ${spinClass} ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<path d="M7.99997 6C6.89497 6 5.99997 6.895 5.99997 8C5.99997 9.105 6.89497 10 7.99997 10C9.10497 10 9.99997 9.105 9.99997 8C9.99997 6.895 9.10497 6 7.99997 6ZM7.99997 9C7.44797 9 6.99997 8.552 6.99997 8C6.99997 7.448 7.44797 7 7.99997 7C8.55197 7 8.99997 7.448 8.99997 8C8.99997 8.552 8.55197 9 7.99997 9ZM14.565 9.715L13.279 8.628C13.245 8.599 13.213 8.567 13.184 8.533C12.888 8.186 12.931 7.667 13.279 7.372L14.565 6.285C14.693 6.177 14.742 6.003 14.691 5.844C14.386 4.903 13.882 4.04 13.219 3.308C13.139 3.22 13.027 3.172 12.912 3.172C12.865 3.172 12.818 3.18 12.773 3.196L11.186 3.761C11.144 3.776 11.1 3.788 11.056 3.796C11.006 3.805 10.956 3.81 10.907 3.81C10.515 3.81 10.167 3.532 10.094 3.134L9.79097 1.482C9.76097 1.318 9.63397 1.188 9.46997 1.153C8.98997 1.051 8.49897 1 8.00097 1C7.50297 1 7.01097 1.052 6.53097 1.153C6.36697 1.188 6.23997 1.318 6.20997 1.482L5.90797 3.134C5.89997 3.178 5.88797 3.221 5.87297 3.263C5.75197 3.6 5.43397 3.81 5.09397 3.81C5.00197 3.81 4.90797 3.794 4.81597 3.762L3.22897 3.197C3.18397 3.181 3.13597 3.173 3.08997 3.173C2.97497 3.173 2.86297 3.221 2.78297 3.309C2.11897 4.041 1.61597 4.904 1.30997 5.845C1.25797 6.004 1.30797 6.178 1.43597 6.286L2.72197 7.373C2.75597 7.402 2.78797 7.434 2.81697 7.468C3.11297 7.815 3.06997 8.334 2.72197 8.629L1.43597 9.716C1.30797 9.824 1.25897 9.998 1.30997 10.157C1.61497 11.098 2.11897 11.961 2.78297 12.693C2.86297 12.781 2.97497 12.829 3.08997 12.829C3.13697 12.829 3.18397 12.821 3.22897 12.805L4.81597 12.24C4.85797 12.225 4.90197 12.213 4.94597 12.205C4.99597 12.196 5.04597 12.192 5.09497 12.192C5.48697 12.192 5.83497 12.47 5.90797 12.868L6.20997 14.52C6.23997 14.684 6.36697 14.814 6.53097 14.849C7.01097 14.951 7.50297 15.002 8.00097 15.002C8.49897 15.002 8.99097 14.95 9.46997 14.849C9.63397 14.814 9.76097 14.684 9.79097 14.52L10.094 12.868C10.102 12.824 10.114 12.781 10.129 12.739C10.25 12.402 10.568 12.192 10.908 12.192C11 12.192 11.094 12.208 11.186 12.24L12.772 12.805C12.818 12.821 12.865 12.829 12.911 12.829C13.026 12.829 13.138 12.781 13.218 12.693C13.882 11.961 14.385 11.098 14.69 10.157C14.742 9.998 14.692 9.824 14.564 9.716L14.565 9.715ZM12.728 11.726L11.521 11.296C11.323 11.226 11.117 11.19 10.908 11.19C10.139 11.19 9.44697 11.676 9.18797 12.399C9.15397 12.492 9.12897 12.588 9.11097 12.686L8.88097 13.937C8.59097 13.979 8.29597 14 8.00097 14C7.70597 14 7.41097 13.979 7.11997 13.936L6.89097 12.685C6.73197 11.818 5.97697 11.189 5.09497 11.189C4.98697 11.189 4.87697 11.199 4.76597 11.219C4.66897 11.237 4.57397 11.262 4.47997 11.295L3.27297 11.725C2.90497 11.264 2.61097 10.759 2.39397 10.214L3.36797 9.391C3.74097 9.076 3.96797 8.634 4.00797 8.148C4.04797 7.662 3.89497 7.19 3.57797 6.818C3.51397 6.743 3.44297 6.672 3.36797 6.608L2.39397 5.785C2.61097 5.24 2.90497 4.734 3.27297 4.274L4.47997 4.704C4.67797 4.774 4.88397 4.81 5.09397 4.81C5.86297 4.81 6.55497 4.324 6.81397 3.601C6.84797 3.507 6.87297 3.411 6.89097 3.314L7.11997 2.063C7.41097 2.021 7.70597 1.999 8.00097 1.999C8.29597 1.999 8.59097 2.02 8.88097 2.062L9.10997 3.313C9.26897 4.18 10.024 4.809 10.906 4.809C11.014 4.809 11.124 4.799 11.234 4.779C11.331 4.761 11.427 4.736 11.521 4.703L12.728 4.273C13.096 4.733 13.39 5.239 13.607 5.784L12.634 6.607C12.261 6.922 12.033 7.364 11.994 7.85C11.954 8.336 12.107 8.809 12.424 9.18C12.489 9.256 12.559 9.326 12.635 9.39L13.609 10.213C13.392 10.758 13.098 11.264 12.73 11.724L12.728 11.726Z" />
		</svg>
	)
}

// 4. VS Code Copilot Sparkle ($(sparkle)) for AI Thinking
export function VSCodeSparkleIcon({
	size = 16,
	animated = true,
	className = "",
	color,
	ariaLabel = "Thinking",
}) {
	const animClass = animated ? "vscode-sparkle-animated" : ""
	return (
		<span
			className={`vscode-sparkle-wrapper ${animClass} ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<svg
				width={size}
				height={size}
				viewBox="0 0 16 16"
				xmlns="http://www.w3.org/2000/svg"
				fill="currentColor"
				className="vscode-icon vscode-codicon-sparkle"
			>
				<path d="M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962ZM4.00746 6.26448L3.15246 5.99948L4.01646 5.71848C4.41071 5.58184 4.76826 5.35637 5.06146 5.05948C5.35281 4.76039 5.57294 4.39943 5.70546 4.00348L5.97046 3.14448L6.25046 4.00648C6.38349 4.40638 6.60809 4.76969 6.90636 5.06744C7.20463 5.36519 7.56833 5.58915 7.96846 5.72148L8.84846 5.99048L7.98746 6.27048C7.58707 6.40272 7.22321 6.62691 6.92505 6.92507C6.62689 7.22324 6.4027 7.58709 6.27046 7.98748L6.00546 8.84448L5.72646 7.98548C5.63026 7.69329 5.48483 7.41968 5.29646 7.17648C5.22699 7.08766 5.15254 7.00286 5.07346 6.92248C4.7738 6.62366 4.4089 6.39842 4.00746 6.26448ZM10.5344 13.8515C10.6703 13.9477 10.8328 13.9994 10.9994 13.9995C11.1642 13.998 11.3245 13.9456 11.4584 13.8495C11.5979 13.751 11.7029 13.611 11.7584 13.4495L12.0064 12.6875C12.0595 12.529 12.1485 12.385 12.2664 12.2665C12.3837 12.148 12.5277 12.0592 12.6864 12.0075L13.4584 11.7555C13.6161 11.701 13.7528 11.5985 13.8494 11.4625C13.9227 11.3595 13.9706 11.2405 13.9891 11.1154C14.0076 10.9903 13.9962 10.8626 13.9558 10.7428C13.9154 10.623 13.8472 10.5144 13.7567 10.4261C13.6662 10.3377 13.5561 10.272 13.4354 10.2345L12.6714 9.98548C12.5132 9.93291 12.3695 9.8443 12.2514 9.72663C12.1334 9.60896 12.0444 9.46547 11.9914 9.30748L11.7394 8.53348C11.685 8.37623 11.5825 8.24011 11.4464 8.14448C11.3443 8.07153 11.2266 8.02359 11.1026 8.00453C10.9787 7.98547 10.8519 7.99582 10.7327 8.03475C10.6135 8.07369 10.5051 8.1401 10.4163 8.22865C10.3274 8.31719 10.2607 8.42538 10.2214 8.54448L9.97435 9.30648C9.92207 9.46413 9.83452 9.60777 9.71835 9.72648C9.60382 9.84272 9.46428 9.9313 9.31035 9.98548L8.53435 10.2385C8.41689 10.2793 8.31057 10.347 8.22382 10.4361C8.13708 10.5252 8.0723 10.6333 8.03464 10.7518C7.99698 10.8704 7.98746 10.996 8.00686 11.1189C8.02625 11.2417 8.07401 11.3583 8.14635 11.4595C8.24456 11.5993 8.38462 11.7044 8.54635 11.7595L9.30935 12.0065C9.46821 12.0599 9.61262 12.1492 9.73135 12.2675C9.84958 12.3857 9.93801 12.5304 9.98935 12.6895L10.2424 13.4635C10.2971 13.6199 10.3992 13.7555 10.5344 13.8515ZM9.62035 11.0585L9.44235 10.9995L9.62635 10.9355C9.92811 10.8305 10.2018 10.6578 10.4264 10.4305C10.6528 10.2015 10.8238 9.92374 10.9264 9.61848L10.9844 9.44048L11.0434 9.62148C11.1453 9.92819 11.3175 10.2069 11.5461 10.4353C11.7748 10.6638 12.0536 10.8357 12.3604 10.9375L12.5554 11.0005L12.3754 11.0595C12.068 11.1617 11.7888 11.3344 11.5601 11.5637C11.3314 11.7931 11.1596 12.0728 11.0584 12.3805L10.9994 12.5615L10.9414 12.3805C10.84 12.0721 10.6676 11.7919 10.4382 11.5623C10.2088 11.3326 9.92863 11.1601 9.62035 11.0585Z" />
			</svg>
		</span>
	)
}

// 5. VS Code Pass / Success ($(pass))
export function VSCodePassIcon({
	size = 16,
	className = "",
	color,
	ariaLabel = "Passed",
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={`vscode-icon vscode-codicon-pass ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<path d="M10.6484 5.64648C10.8434 5.45148 11.1605 5.45148 11.3555 5.64648C11.5498 5.84137 11.5499 6.15766 11.3555 6.35254L7.35547 10.3525C7.25747 10.4495 7.12898 10.499 7.00098 10.499C6.87299 10.499 6.74545 10.4505 6.64746 10.3525L4.64746 8.35254C4.45247 8.15754 4.45248 7.84148 4.64746 7.64648C4.84246 7.45148 5.15949 7.45148 5.35449 7.64648L7 9.29199L10.6465 5.64648H10.6484Z" />
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M8 1C11.86 1 15 4.14 15 8C15 11.86 11.86 15 8 15C4.14 15 1 11.86 1 8C1 4.14 4.14 1 8 1ZM8 2C4.691 2 2 4.691 2 8C2 11.309 4.691 14 8 14C11.309 14 14 11.309 14 8C14 4.691 11.309 2 8 2Z"
			/>
		</svg>
	)
}

// 6. VS Code Error ($(error))
export function VSCodeErrorIcon({
	size = 16,
	className = "",
	color,
	ariaLabel = "Error",
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={`vscode-icon vscode-codicon-error ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<path d="M8 1C4.14 1 1 4.14 1 8C1 11.86 4.14 15 8 15C11.86 15 15 11.86 15 8C15 4.14 11.86 1 8 1ZM8 14C4.691 14 2 11.309 2 8C2 4.691 4.691 2 8 2C11.309 2 14 4.691 14 8C14 11.309 11.309 14 8 14ZM10.854 5.854L8.708 8L10.854 10.146C11.049 10.341 11.049 10.658 10.854 10.853C10.756 10.951 10.628 10.999 10.5 10.999C10.372 10.999 10.244 10.95 10.146 10.853L8 8.707L5.854 10.853C5.756 10.951 5.628 10.999 5.5 10.999C5.372 10.999 5.244 10.95 5.146 10.853C4.951 10.658 4.951 10.341 5.146 10.146L7.292 8L5.146 5.854C4.951 5.659 4.951 5.342 5.146 5.147C5.341 4.952 5.658 4.952 5.853 5.147L7.999 7.293L10.145 5.147C10.34 4.952 10.657 4.952 10.852 5.147C11.047 5.342 11.047 5.659 10.852 5.854H10.854Z" />
		</svg>
	)
}

// 7. VS Code Circle Outline / Idle ($(circle-outline))
export function VSCodeCircleIcon({
	size = 16,
	className = "",
	color,
	ariaLabel = "Idle",
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
			fill="currentColor"
			className={`vscode-icon vscode-codicon-circle ${className}`.trim()}
			style={color ? { color } : undefined}
			role="img"
			aria-label={ariaLabel}
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12ZM10.6093 8C10.6093 9.44108 9.44107 10.6093 8 10.6093C6.55893 10.6093 5.39071 9.44108 5.39071 8C5.39071 6.55893 6.55893 5.39071 8 5.39071C9.44107 5.39071 10.6093 6.55893 10.6093 8Z"
			/>
		</svg>
	)
}

// 8. VS Code Sonar / Radar Pulse Dot (for waiting_for_input)
export function VSCodePulseDot({
	size = 12,
	className = "",
	color,
	ariaLabel = "Awaiting input",
}) {
	return (
		<span
			className={`vscode-pulse-sonar ${className}`.trim()}
			style={{
				width: size,
				height: size,
				...(color ? { color } : {}),
			}}
			role="img"
			aria-label={ariaLabel}
		>
			<span className="vscode-pulse-dot-core" />
		</span>
	)
}

// 9. VS Code Indeterminate Progress Bar (The sleek top accent runner)
export function VSCodeProgressBar({
	active = true,
	variant = "running", // "running" | "thinking"
	className = "",
}) {
	if (!active) return null
	return (
		<div
			className={`vscode-progress-bar vscode-progress-bar--${variant} ${className}`.trim()}
			role="progressbar"
			aria-valuetext="In progress"
		>
			<div className="vscode-progress-bar__line" />
		</div>
	)
}

/**
 * Universal State Icon component
 * Automatically selects the appropriate VS Code Codicon and animation
 * based on state: "running", "thinking", "waiting_for_input", "idle", "completed", "error".
 */
export function VSCodeWorkingStateIcon({
	status = "idle",
	toolActive = false,
	size = 16,
	spinSmooth = false,
	className = "",
}) {
	if (toolActive) {
		return (
			<VSCodeGearIcon
				size={size}
				spin={true}
				className={`text-sky-400 ${className}`}
				ariaLabel="Executing tool"
			/>
		)
	}

	switch (status) {
		case "thinking":
			return (
				<VSCodeSparkleIcon
					size={size}
					animated={true}
					className={`text-purple-400 ${className}`}
					ariaLabel="Thinking"
				/>
			)

		case "running":
			return (
				<VSCodeLoadingIcon
					size={size}
					spin={true}
					smooth={spinSmooth}
					className={`text-emerald-400 ${className}`}
					ariaLabel="Running"
				/>
			)

		case "syncing":
			return (
				<VSCodeSyncIcon
					size={size}
					spin={true}
					smooth={spinSmooth}
					className={`text-blue-400 ${className}`}
					ariaLabel="Syncing"
				/>
			)

		case "waiting_for_input":
		case "needs_input":
		case "awaiting":
			return (
				<VSCodePulseDot
					size={Math.max(10, size - 2)}
					className={`text-amber-400 ${className}`}
					ariaLabel="Waiting for input"
				/>
			)

		case "completed":
		case "done":
		case "success":
			return (
				<VSCodePassIcon
					size={size}
					className={`text-emerald-400 ${className}`}
					ariaLabel="Completed"
				/>
			)

		case "error":
		case "failed":
			return (
				<VSCodeErrorIcon
					size={size}
					className={`text-rose-400 ${className}`}
					ariaLabel="Error"
				/>
			)

		case "idle":
		default:
			return (
				<VSCodeCircleIcon
					size={size}
					className={`text-slate-400 opacity-60 ${className}`}
					ariaLabel="Idle"
				/>
			)
	}
}

/**
 * Interactive Showcase Component for developer preview and testing
 */
export function VSCodeIconsShowcase() {
	const [spinType, setSpinType] = React.useState("steps") // "steps" | "smooth"
	const [activeDemoState, setActiveDemoState] = React.useState("running")

	const states = [
		{ id: "thinking", label: "Thinking (Copilot Sparkle)", color: "#c084fc" },
		{ id: "running", label: "Running ($(loading~spin))", color: "#4ade80" },
		{ id: "tool", label: "Tool Executing ($(gear~spin))", color: "#38bdf8" },
		{ id: "syncing", label: "Syncing ($(sync~spin))", color: "#60a5fa" },
		{ id: "waiting_for_input", label: "Waiting for Input (Sonar Pulse)", color: "#facc15" },
		{ id: "completed", label: "Completed ($(pass))", color: "#4ade80" },
		{ id: "error", label: "Error ($(error))", color: "#f87171" },
		{ id: "idle", label: "Idle ($(circle-outline))", color: "#94a3b8" },
	]

	return (
		<div className="vscode-showcase-card">
			<div className="vscode-showcase-header">
				<div className="vscode-showcase-title">
					<VSCodeSparkleIcon size={18} className="text-purple-400" />
					<h3>VS Code Working State Icons</h3>
				</div>
				<div className="vscode-showcase-toggle">
					<button
						type="button"
						className={`vscode-toggle-btn ${spinType === "steps" ? "vscode-toggle-btn--active" : ""}`}
						onClick={() => setSpinType("steps")}
					>
						Stepped Spin (steps: 30)
					</button>
					<button
						type="button"
						className={`vscode-toggle-btn ${spinType === "smooth" ? "vscode-toggle-btn--active" : ""}`}
						onClick={() => setSpinType("smooth")}
					>
						Smooth Spin (linear)
					</button>
				</div>
			</div>

			<VSCodeProgressBar
				active={true}
				variant={activeDemoState === "thinking" ? "thinking" : "running"}
			/>

			<div className="vscode-showcase-grid">
				{states.map((st) => (
					<div
						key={st.id}
						className={`vscode-showcase-item ${activeDemoState === st.id ? "vscode-showcase-item--selected" : ""}`}
						onClick={() => setActiveDemoState(st.id)}
					>
						<div className="vscode-showcase-icon-box">
							{st.id === "tool" ? (
								<VSCodeGearIcon size={20} spin={true} color={st.color} />
							) : (
								<VSCodeWorkingStateIcon
									status={st.id}
									size={20}
									spinSmooth={spinType === "smooth"}
								/>
							)}
						</div>
						<div className="vscode-showcase-meta">
							<span className="vscode-showcase-item-title">{st.label}</span>
							<span className="vscode-showcase-item-sub">State: {st.id}</span>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

export default VSCodeWorkingStateIcon
