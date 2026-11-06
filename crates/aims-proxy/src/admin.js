(() => {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  const theme =
    param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

const $ = (id) => document.getElementById(id);
let sessions = [];
let auditLogs = [];
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

function visibleAuditLogs() {
  const query = ($("audit-search") ? $("audit-search").value.toLowerCase() : "");
  const filter = ($("audit-filter") ? $("audit-filter").value : "all");
  return auditLogs.filter((log) => {
    if (filter === "user_message" && log.event !== "user_message") return false;
    if (filter === "create_session" && log.event !== "create_session") return false;
    if (filter === "error" && log.level !== "error") return false;
    if (!query) return true;
    const text = `${log.event} ${log.summary} ${log.conversation_id || ""} ${log.session_id || ""}`.toLowerCase();
    return text.includes(query);
  });
}

function renderAuditLogs() {
  const tbody = $("audit-rows");
  if (!tbody) return;
  const visible = visibleAuditLogs();
  tbody.replaceChildren(...visible.map((log) => {
    const row = document.createElement("tr");

    const timeCell = row.insertCell();
    const d = new Date(log.timestamp);
    timeCell.textContent = isNaN(d) ? log.timestamp : d.toLocaleTimeString();
    timeCell.style.whiteSpace = "nowrap";

    const eventCell = row.insertCell();
    const eventBadge = document.createElement("span");
    eventBadge.className = `badge ${log.level || "info"}`;
    eventBadge.textContent = log.event;
    eventCell.append(eventBadge);

    const dirCell = row.insertCell();
    dirCell.style.fontSize = "12px";
    dirCell.style.color = "var(--cp-text-muted)";
    dirCell.textContent = log.direction === "app_to_proxy"
      ? "App → Proxy"
      : log.direction === "proxy_to_host"
      ? "Proxy → Host"
      : log.direction === "proxy_to_app"
      ? "Proxy → App"
      : log.direction;

    const idCell = row.insertCell();
    const convText = log.conversation_id ? `Conv #${log.conversation_id}` : "";
    const sessText = log.session_id ? log.session_id : "";
    if (convText) {
      const strong = document.createElement("strong");
      strong.style.display = "block";
      strong.textContent = convText;
      idCell.append(strong);
    }
    if (sessText) {
      const small = document.createElement("small");
      small.textContent = sessText.length > 20 ? `${sessText.slice(0, 10)}…${sessText.slice(-8)}` : sessText;
      small.title = sessText;
      idCell.append(small);
    }
    if (!convText && !sessText) {
      idCell.textContent = "—";
    }

    const sumCell = row.insertCell();
    const sumP = document.createElement("span");
    sumP.textContent = log.summary;
    sumCell.append(sumP);
    if (log.details) {
      const details = document.createElement("details");
      details.className = "audit-details";
      const summary = document.createElement("summary");
      summary.textContent = "Raw payload / details";
      const pre = document.createElement("pre");
      pre.textContent = typeof log.details === "string" ? log.details : JSON.stringify(log.details, null, 2);
      details.append(summary, pre);
      sumCell.append(details);
    }

    return row;
  }));
  if ($("audit-empty")) {
    $("audit-empty").hidden = visible.length > 0;
  }
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
    auditLogs = (data.audit_logs || []).slice().reverse();
    renderAuditLogs();
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
if ($("clear-audit")) {
  $("clear-audit").addEventListener("click", async () => {
    try {
      await fetch("/api/audit-logs/clear", { method: "POST" });
      auditLogs = [];
      renderAuditLogs();
    } catch (_) {}
  });
}
if ($("audit-search")) $("audit-search").addEventListener("input", renderAuditLogs);
if ($("audit-filter")) $("audit-filter").addEventListener("change", renderAuditLogs);
refresh();
setInterval(refresh, 5000);
