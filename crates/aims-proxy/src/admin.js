(() => {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  const theme =
    param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

const $ = (id) => document.getElementById(id);
let sessions = [];
let connected = false;
let archiveSupported = false;
let busy = false;
let refreshing = false;
const selected = new Set();
const eligible = (session) =>
  !session.is_subagent && session.completed && ["idle", "completed", "done"].includes(session.status);

function visibleSessions() {
  const query = $("search").value.toLowerCase();
  return sessions.filter((session) => {
    if (!`${session.title} ${session.id}`.toLowerCase().includes(query)) return false;
    switch ($("filter").value) {
      case "completed": return eligible(session);
      case "active": return ["running", "thinking", "waiting_for_input"].includes(session.status);
      case "archived": return session.status === "archived";
      case "subagents": return session.is_subagent;
      default: return true;
    }
  });
}

function feedback(message, error = false) {
  $("feedback").textContent = message;
  $("feedback").className = error ? "error" : "";
}

function updateActions() {
  const chosen = sessions.filter((session) => selected.has(session.id));
  $("selection").textContent = `${chosen.length} selected`;
  $("resync").disabled = busy || !connected || chosen.length === 0 || chosen.length > 100;
  $("archive").disabled = busy || !connected || !archiveSupported || chosen.length === 0 || chosen.length > 100 || !chosen.every(eligible);
  $("select-completed").disabled = busy;
}

function render() {
  const visible = visibleSessions();
  $("sessions").replaceChildren(...visible.map((session) => {
    const row = document.createElement("tr");
    const checkCell = row.insertCell();
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(session.id);
    checkbox.disabled = busy || session.status === "archived";
    checkbox.setAttribute("aria-label", `Select ${session.title}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(session.id);
      else selected.delete(session.id);
      updateActions();
    });
    checkCell.append(checkbox);
    const title = row.insertCell();
    const strong = document.createElement("strong");
    strong.textContent = session.title;
    const id = document.createElement("small");
    id.textContent = session.id;
    title.append(strong, id);
    if (session.is_subagent) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Subagent";
      title.append(badge);
    }
    const status = document.createElement("span");
    status.className = `badge${["running", "thinking", "waiting_for_input"].includes(session.status) ? " active" : ""}`;
    status.textContent = session.status.replaceAll("_", " ");
    row.insertCell().append(status);
    const archive = row.insertCell();
    archive.textContent = session.is_subagent
      ? session.hidden_in_aims ? "Hidden in AIMS" : "Hiding in AIMS…"
      : eligible(session) ? "Completed latest turn" : session.status === "archived" ? "Already archived" : "Not confirmed complete";
    if (eligible(session)) archive.className = "eligible";
    return row;
  }));
  $("empty").hidden = visible.length > 0;
  updateActions();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error("Cannot reach the local proxy.");
    const data = await response.json();
    connected = data.connected;
    archiveSupported = data.archive_supported;
    sessions = Object.values(data.sessions).sort((a, b) => a.title.localeCompare(b.title));
    for (const id of selected) {
      if (!sessions.some((session) => session.id === id && session.status !== "archived")) selected.delete(id);
    }
    $("connection").textContent = connected ? data.syncing ? "Connected · syncing" : "Connected" : "Disconnected";
    $("total").textContent = sessions.length;
    $("completed").textContent = sessions.filter(eligible).length;
    const subagents = sessions.filter((session) => session.is_subagent);
    $("subagents").textContent = `${subagents.length} confirmed subagents · ${subagents.filter((session) => session.hidden_in_aims).length} AIMS visibility updates acknowledged. VS Code is unchanged.`;
    $("updated").textContent = data.last_update ? new Date(data.last_update).toLocaleTimeString() : "Waiting";
    if (data.error) feedback(data.error, true);
    else if (connected && !archiveSupported) feedback("Viewing and resync are available. Deploy the updated aims-server to enable AIMS-only archiving.", true);
    render();
  } catch (error) {
    connected = false;
    $("connection").textContent = "Unavailable";
    feedback(error.message, true);
    updateActions();
  } finally {
    refreshing = false;
  }
}

async function action(path) {
  if (busy) return;
  busy = true;
  render();
  feedback(path === "archive" ? "Waiting for AIMS to confirm the archive…" : "Refreshing selected resources…");
  try {
    const response = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Action failed.");
    if (path === "archive") {
      const failed = result.failed_session_ids || [];
      feedback(`${result.archived_session_ids.length} archived in AIMS.${failed.length ? ` ${failed.length} could not be archived; they may still be active or missing in AIMS.` : ""}`, failed.length > 0);
    } else feedback(result.message);
    selected.clear();
    await refresh();
  } catch (error) {
    feedback(error.message, true);
  } finally {
    busy = false;
    render();
  }
}

$("search").addEventListener("input", render);
$("filter").addEventListener("change", render);
$("refresh").addEventListener("click", refresh);
$("select-completed").addEventListener("click", () => {
  for (const session of visibleSessions().filter(eligible).slice(0, 100)) selected.add(session.id);
  render();
});
$("resync").addEventListener("click", () => action("resync"));
$("archive").addEventListener("click", () => {
  const chosen = sessions.filter((session) => selected.has(session.id));
  if (!chosen.length || !chosen.every(eligible)) return;
  $("confirm-titles").replaceChildren(...chosen.map((session) => {
    const item = document.createElement("li");
    item.textContent = session.title;
    return item;
  }));
  $("confirm").showModal();
});
$("cancel").addEventListener("click", () => $("confirm").close());
$("confirm-archive").addEventListener("click", () => {
  $("confirm").close();
  action("archive");
});
refresh();
setInterval(refresh, 5000);
