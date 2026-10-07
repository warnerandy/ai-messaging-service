import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import AuthPanelView from "./components/AuthPanel.jsx"
import ChatView from "./components/ChatView.jsx"
import Sidebar from "./components/Sidebar.jsx"
import { useWorkspaceData } from "./hooks/useWorkspaceData.js"
import "../css/app.css"
import { Spinner } from "@heroui/react"

/* ───────── Main App ───────── */
function App() {
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

	useEffect(() => {
		const splash = document.getElementById("splash-screen")
		if (splash) {
			splash.classList.add("splash-hidden")
			setTimeout(() => splash.remove(), 500)
		}
	}, [])
	const {
		token,
		userEmail,
		bots,
		selectedBotId,
		conversations,
		selectedConversationId,
		models,
		loading,
		appConnection,
		selectedBot,
		handleAuth,
		handleLogout,
		loadBots,
		selectBot,
		selectConversation,
		handleCreateConversation,
		handleRefreshModels,
		handleBotStatusChange,
		handleDeleteBot,
	} = useWorkspaceData()

	if (!token) {
		return <AuthPanelView onAuth={handleAuth} />
	}

	return (
		<div id="workspace" className="app-layout">
			{loading ? (
				<div className="loading-container">
					<Spinner size="lg" />
				</div>
			) : (
				<>
					{mobileSidebarOpen && (
						<div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} />
					)}
					<Sidebar
						token={token}
						bots={bots}
						selectedBotId={selectedBotId}
						conversations={conversations}
						selectedConversationId={selectedConversationId}
						onSelectBot={(id) => {
							selectBot(id)
							setMobileSidebarOpen(false)
						}}
						onSelectConversation={(id) => {
							selectConversation(id)
							setMobileSidebarOpen(false)
						}}
						onCreateConversation={handleCreateConversation}
						onBotsChange={loadBots}
						onDeleteBot={handleDeleteBot}
						userEmail={userEmail}
						onLogout={handleLogout}
						isOpen={mobileSidebarOpen}
						appConnection={appConnection}
					/>
					<ChatView
						token={token}
						bot={selectedBot}
						conversations={conversations}
						selectedConversationId={selectedConversationId}
						models={models}
						onRefreshModels={handleRefreshModels}
						onBotStatusChange={handleBotStatusChange}
						onToggleSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
					/>
				</>
			)}
		</div>
	)
}

/* ───────── Mount ───────── */
const root = createRoot(document.getElementById("app"))
root.render(<App />)
