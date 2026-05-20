import DOMPurify from "dompurify"
import { marked } from "marked"
import hljs from "highlight.js/lib/core"
import elixir from "highlight.js/lib/languages/elixir"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import bash from "highlight.js/lib/languages/bash"
import xml from "highlight.js/lib/languages/xml"
import markdown from "highlight.js/lib/languages/markdown"
import "highlight.js/styles/github-dark.css"

hljs.registerLanguage("elixir", elixir)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sh", bash)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("markdown", markdown)

marked.setOptions({
	gfm: true,
	breaks: true,
})

export function renderMarkdown(rawText) {
	if (!rawText) return ""

	const html = marked.parse(rawText)
	const sanitizedHtml = DOMPurify.sanitize(html)

	if (typeof document === "undefined") return sanitizedHtml

	const template = document.createElement("template")
	template.innerHTML = sanitizedHtml

	template.content.querySelectorAll("pre code").forEach((codeBlock) => {
		const className = codeBlock.className || ""
		const langMatch = className.match(/language-([\w-]+)/)
		const lang = langMatch?.[1]?.toLowerCase()
		const code = codeBlock.textContent || ""

		const highlighted =
			lang && hljs.getLanguage(lang)
				? hljs.highlight(code, { language: lang })
				: hljs.highlightAuto(code)

		codeBlock.innerHTML = highlighted.value
		codeBlock.classList.add("hljs")
		if (lang) {
			codeBlock.classList.add(`language-${lang}`)
		}
	})

	return template.innerHTML
}
