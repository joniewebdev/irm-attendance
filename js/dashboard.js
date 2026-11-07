import { supabase } from "./supabase-client.js";
import { requireActiveSession, watchAuthState } from "./auth-guard.js";
import { showToast } from "./utilities.js";

const $ = (id) => document.getElementById(id);
const nowInManila = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
const TZ = "Asia/Manila";
const number = (value) => new Intl.NumberFormat("en-PH").format(value || 0);
const monthLabel = (date) => new Intl.DateTimeFormat("en-PH", { month: "short", timeZone: TZ }).format(date);
const fullDate = (dateString) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: TZ }).format(new Date(`${dateString}T00:00:00+08:00`));
const eventTypeLabel = (type) => ({ sunday_service: "Sunday service", midweek_service: "Midweek", prayer_meeting: "Prayer meeting", youth_fellowship: "Youth fellowship", special_event: "Special event", other: "Other" }[type] || type || "Activity");

watchAuthState();
const auth = await requireActiveSession();
if (!auth) throw new Error("No active session");

const { profile } = auth;
const roleLabel = profile.role.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
$("top-username").textContent = profile.username;
$("top-role").textContent = roleLabel;
$("user-avatar").textContent = profile.username.slice(0, 1).toUpperCase();
$("today-label").textContent = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: TZ }).format(new Date());
const hour = Number(new Intl.DateTimeFormat("en-PH", { hour: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date()));
$("welcome-title").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${profile.username}!`;

// Only administrators see administration navigation.
if (profile.role !== "administrator") {
  $("admin-nav-label").hidden = true;
  $("admin-nav").hidden = true;
}

async function loadDashboard() {
  const refresh = $("refresh-button");
  refresh.disabled = true;
  refresh.classList.add("is-loading");
  $("dashboard-error").hidden = true;
  try {
    const manilaNow = nowInManila();
    const chartStart = new Date(manilaNow.getFullYear(), manilaNow.getMonth() - 5, 1);
    const chartStartDate = `${chartStart.getFullYear()}-${String(chartStart.getMonth() + 1).padStart(2, "0")}-01`;
    const [membersResult, eventsResult, ownMemberResult] = await Promise.all([
      supabase.from("member_directory")
        .select("id,first_name,middle_name,last_name,suffix,is_visitor,is_archived,membership_status,kapisanan_code,kapisanan_name")
        .eq("is_archived", false),
      supabase.from("attendance_events")
        .select("id,event_name,event_type,event_date,is_archived,attendance_records(count)")
        .eq("is_archived", false)
        .gte("event_date", chartStartDate)
        .order("event_date", { ascending: false })
        .limit(1000),
      supabase.from("member_directory")
        .select("first_name,middle_name,last_name,suffix,nickname")
        .eq("id", profile.member_id)
        .maybeSingle()
    ]);

    if (membersResult.error) throw membersResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (ownMemberResult.error) console.warn("Could not load linked member name:", ownMemberResult.error.message);

    const allMembers = membersResult.data || [];
    const regularMembers = allMembers.filter((m) => !m.is_visitor);
    const visitors = allMembers.filter((m) => m.is_visitor);
    const countStatus = (status) => regularMembers.filter((m) => m.membership_status === status).length;

    $("stat-total").textContent = number(regularMembers.length);
    $("stat-active").textContent = number(countStatus("active"));
    $("stat-inactive").textContent = number(countStatus("inactive"));
    $("stat-abroad").textContent = number(countStatus("abroad"));
    $("stat-visitors").textContent = number(visitors.length);

    const linked = ownMemberResult.data;
    if (linked) {
      const displayName = [linked.first_name, linked.middle_name, linked.last_name, linked.suffix].filter(Boolean).join(" ");
      $("welcome-title").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${linked.nickname || displayName || profile.username}!`;
    }

    renderAttendanceChart(eventsResult.data || []);
    renderKapisanan(regularMembers);
    renderRecentEvents(eventsResult.data || []);
  } catch (error) {
    console.error("Dashboard load failed:", error);
    $("dashboard-error").textContent = `Unable to load dashboard data: ${error.message || "Please try again."}`;
    $("dashboard-error").hidden = false;
    showToast("Some dashboard information could not be loaded.", "error");
    $("attendance-chart").innerHTML = '<div class="chart-empty">Attendance data unavailable</div>';
    $("kapisanan-legend").innerHTML = '<div class="chart-empty">Group data unavailable</div>';
    $("recent-events").innerHTML = '<tr><td colspan="4" class="table-empty">Event data unavailable</td></tr>';
  } finally {
    refresh.disabled = false;
    refresh.classList.remove("is-loading");
  }
}

function renderAttendanceChart(events) {
  const now = new Date();
  const monthStarts = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthStarts.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: monthLabel(d), count: 0 });
  }
  const byKey = new Map(monthStarts.map((m) => [m.key, m]));
  let total = 0;
  for (const event of events) {
    const key = String(event.event_date).slice(0, 7);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const count = Number(event.attendance_records?.[0]?.count || 0);
    bucket.count += count;
    total += count;
  }
  const max = Math.max(1, ...monthStarts.map((m) => m.count));
  $("attendance-chart").innerHTML = monthStarts.map((m) => {
    const height = m.count ? Math.max(5, Math.round((m.count / max) * 100)) : 2;
    return `<div class="bar-column"><div class="bar-value">${number(m.count)}</div><div class="bar-track"><div class="bar-fill" style="height:${height}%" title="${m.label}: ${number(m.count)} attendance records"></div></div><span class="bar-label">${m.label}</span></div>`;
  }).join("");
  $("attendance-total").textContent = `${number(total)} total records`;
}

function renderKapisanan(members) {
  const groups = new Map();
  for (const member of members) {
    const code = member.kapisanan_code || "UNASSIGNED";
    const name = member.kapisanan_name || "Unassigned";
    if (!groups.has(code)) groups.set(code, { code, name, count: 0 });
    groups.get(code).count++;
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count);
  const total = members.length;
  const palette = ["#245b4b", "#6c9b82", "#d3a34b", "#7d91b4", "#a58bb9", "#b7c5bd"];
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += total ? (row.count / total) * 100 : 0;
    return `${palette[index % palette.length]} ${start}% ${cursor}%`;
  });
  $("kapisanan-total").textContent = number(total);
  $("kapisanan-donut").style.background = total ? `conic-gradient(${segments.join(",")})` : "conic-gradient(#e8eeeb 0% 100%)";
  $("kapisanan-legend").innerHTML = rows.length ? rows.map((row, index) => {
    const pct = total ? Math.round((row.count / total) * 100) : 0;
    return `<div class="legend-row"><span class="legend-name"><i style="background:${palette[index % palette.length]}"></i><span>${escapeHtml(row.code === "UNASSIGNED" ? row.name : row.code)}</span></span><strong>${number(row.count)} <small>${pct}%</small></strong></div>`;
  }).join("") : '<div class="chart-empty">No member records yet</div>';
}

function renderRecentEvents(events) {
  const recent = events.slice(0, 6);
  $("recent-events").innerHTML = recent.length ? recent.map((event) => {
    const count = Number(event.attendance_records?.[0]?.count || 0);
    return `<tr><td><strong>${escapeHtml(event.event_name)}</strong></td><td><span class="event-type">${escapeHtml(eventTypeLabel(event.event_type))}</span></td><td>${fullDate(event.event_date)}</td><td class="align-right"><strong>${number(count)}</strong></td></tr>`;
  }).join("") : '<tr><td colspan="4" class="table-empty">No attendance events have been recorded yet.</td></tr>';
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

$("refresh-button").addEventListener("click", loadDashboard);
$("logout-button").addEventListener("click", async () => {
  const button = $("logout-button");
  button.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast(error.message, "error");
    button.disabled = false;
    return;
  }
  location.replace("./login.html");
});

document.querySelectorAll(".coming-soon").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    showToast(`${button.dataset.module || "This section"} will be available in a later module.`);
  });
});

const sidebar = $("sidebar");
const scrim = $("mobile-scrim");
function closeMenu() {
  sidebar.classList.remove("sidebar-open");
  scrim.hidden = true;
  $("menu-toggle").setAttribute("aria-expanded", "false");
}
$("menu-toggle").addEventListener("click", () => {
  const open = sidebar.classList.toggle("sidebar-open");
  scrim.hidden = !open;
  $("menu-toggle").setAttribute("aria-expanded", String(open));
});
scrim.addEventListener("click", closeMenu);

await loadDashboard();
