import { useState } from "react"
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
		handleCreateConversation,
		handleRefreshModels,
		handleBotStatusChange,
		handleDeleteBot,
		setSelectedConversationId,
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
						onSelectBot={(id) => {
							selectBot(id)
							setMobileSidebarOpen(false)
						}}
						onBotsChange={loadBots}
						onDeleteBot={handleDeleteBot}
						conversations={conversations}
						selectedConversationId={selectedConversationId}
						onSelectConversation={(id) => {
							setSelectedConversationId(id)
							setMobileSidebarOpen(false)
						}}
						onCreateConversation={() => {
							handleCreateConversation()
							setMobileSidebarOpen(false)
						}}
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
						onSelectConversation={setSelectedConversationId}
						onCreateConversation={handleCreateConversation}
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
