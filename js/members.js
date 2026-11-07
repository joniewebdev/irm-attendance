import {
    supabase
} from "./supabase-client.js";
import {
    requireActiveSession,
    watchAuthState
} from "./auth-guard.js";
import {
    can
} from "./permissions.js";
import {
    showToast
} from "./utilities.js";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
} [c]));
const fmtDate = (v) => v ? new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
}).format(new Date(`${v}T00:00:00+08:00`)) : "—";
const fullName = (m) => [m.first_name, m.middle_name, m.last_name, m.suffix].filter(Boolean).join(" ");
const statusLabel = (s) => ({
    active: "Active",
    inactive: "Inactive",
    abroad: "Abroad"
} [s] || "Unknown");

watchAuthState();
const auth = await requireActiveSession();
if (!auth) throw new Error("No active session");
const {
    profile,
    session
} = auth;
const canWrite = can(profile, "members.write");
const isAdmin = profile.role === "administrator";
$("top-username").textContent = profile.username;
$("top-role").textContent = profile.role.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
$("user-avatar").textContent = profile.username.slice(0, 1).toUpperCase();
$("today-label").textContent = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila"
}).format(new Date());
if (!isAdmin) {
    $("admin-nav-label").hidden = true;
    $("admin-nav").hidden = true;
}
if (!canWrite) {
    $("add-member").hidden = true;
    $("empty-add").hidden = true;
}
if (!isAdmin) $("override-panel").hidden = true;

let members = [];
let kapisanan = [];
let archiveTarget = null;
let profileTarget = null;

async function loadReferenceData() {
    const {
        data,
        error
    } = await supabase.from("kapisanan").select("id,code,name").eq("is_active", true).order("code");
    if (error) throw error;
    kapisanan = data || [];
    const options = kapisanan.map(k => `<option value="${esc(k.id)}">${esc(k.code)} — ${esc(k.name)}</option>`).join("");
    $("filter-kapisanan").insertAdjacentHTML("beforeend", options);
    $("kapisanan").insertAdjacentHTML("beforeend", options);
}

async function loadMembers() {
    const button = $("refresh-members");
    button.disabled = true;
    button.classList.add("is-loading");
    $("page-error").hidden = true;
    try {
        const {
            data,
            error
        } = await supabase.from("member_directory")
            .select("id,first_name,middle_name,last_name,nickname,suffix,gender,birth_date,address,kapisanan_id,kapisanan_code,kapisanan_name,year_joined,is_unlisted,is_visitor,is_archived,remarks,status_override,status_override_reason,membership_status,last_attendance_date")
            .eq("is_archived", false).order("last_name", {
                ascending: true
            }).order("first_name", {
                ascending: true
            }).limit(3000);
        if (error) throw error;
        members = data || [];
        render();
    } catch (error) {
        console.error("Member directory load failed", error);
        $("page-error").textContent = `Unable to load members: ${error.message || "Please try again."}`;
        $("page-error").hidden = false;
        showToast("Unable to load member records.", "error");
        $("members-body").innerHTML = '<tr><td colspan="6" class="table-empty">Member records could not be loaded.</td></tr>';
    } finally {
        button.disabled = false;
        button.classList.remove("is-loading");
    }
}

function render() {
    const regular = members.filter(m => !m.is_visitor);
    $("count-total").textContent = regular.length;
    $("count-active").textContent = regular.filter(m => m.membership_status === "active").length;
    $("count-inactive").textContent = regular.filter(m => m.membership_status === "inactive").length;
    $("count-abroad").textContent = regular.filter(m => m.membership_status === "abroad").length;
    $("count-visitors").textContent = members.filter(m => m.is_visitor).length;
    const q = $("member-search").value.trim().toLowerCase();
    const group = $("filter-kapisanan").value,
        status = $("filter-status").value,
        type = $("filter-type").value;
    const shown = members.filter(m => {
        const searchable = [m.first_name, m.middle_name, m.last_name, m.nickname, m.suffix, m.address, m.kapisanan_code].join(" ").toLowerCase();
        if (q && !searchable.includes(q)) return false;
        if (group && m.kapisanan_id !== group) return false;
        if (status && m.membership_status !== status) return false;
        if (type === "regular" && m.is_visitor) return false;
        if (type === "visitor" && !m.is_visitor) return false;
        if (type === "unlisted" && !m.is_unlisted) return false;
        return true;
    });
    $("result-count").textContent = `Showing ${shown.length.toLocaleString("en-PH")} of ${members.length.toLocaleString("en-PH")} members`;
    $("members-empty").hidden = shown.length !== 0;
    if (!shown.length) {
        $("members-body").innerHTML = "";
        return;
    }
    $("members-body").innerHTML = shown.map(m => {
        const name = fullName(m);
        const tags = [m.is_visitor ? '<span class="mini-tag visitor-tag">Visitor</span>' : "", m.is_unlisted ? '<span class="mini-tag">Unlisted</span>' : ""].filter(Boolean).join(" ");
        const status = m.membership_status || "inactive";
        return `<tr><td><div class="member-cell"><span class="member-avatar">${esc((m.first_name||"?").slice(0,1).toUpperCase())}</span><span class="member-copy"><strong>${esc(name)}</strong><small>${esc(m.nickname?`“${m.nickname}”`:m.address||"No address provided")}</small>${tags?`<span class="member-tags">${tags}</span>`:""}</span></div></td><td>${m.kapisanan_code?`<span class="group-pill">${esc(m.kapisanan_code)}</span>`:'<span class="muted-cell">Unassigned</span>'}</td><td>${m.gender?esc(m.gender[0].toUpperCase()+m.gender.slice(1)):"—"}</td><td><span class="status-pill status-${esc(status)}">${esc(statusLabel(status))}</span>${m.status_override?'<small class="override-note">Manual override</small>':""}</td><td>${fmtDate(m.last_attendance_date)}</td><td class="row-actions"><button class="table-action" data-view="${esc(m.id)}">View</button>${canWrite?`<button class="table-action" data-edit="${esc(m.id)}">Edit</button><button class="table-action archive-action" data-archive="${esc(m.id)}">Archive</button>`:""}</td></tr>`;
    }).join("");
}

function openForm(member = null) {
    if (!canWrite) return;
    $("member-form").reset();
    $("form-error").hidden = true;
    $("duplicate-warning").hidden = true;
    $("member-id").value = member?.id || "";
    $("modal-title").textContent = member ? "Edit member" : "Add member";
    $("save-member").textContent = member ? "Save changes" : "Save member";
    for (const [id, key] of [
            ["first-name", "first_name"],
            ["middle-name", "middle_name"],
            ["last-name", "last_name"],
            ["nickname", "nickname"],
            ["suffix", "suffix"],
            ["gender", "gender"],
            ["birth-date", "birth_date"],
            ["year-joined", "year_joined"],
            ["address", "address"],
            ["remarks", "remarks"]
        ]) $(id).value = member?.[key] ?? "";
    $("kapisanan").value = member?.kapisanan_id || "";
    $("is-visitor").checked = !!member?.is_visitor;
    $("is-unlisted").checked = !!member?.is_unlisted;
    if (isAdmin) {
        $("override-panel").hidden = false;
        $("status-override").value = member?.status_override || "";
        $("override-reason").value = member?.status_override_reason || "";
    }
    $("member-modal").hidden = false;
    $("first-name").focus();
}

function closeModal(id) {
    $(id).hidden = true;
}

function checkDuplicates() {
    const first = $("first-name").value.trim().toLowerCase(),
        last = $("last-name").value.trim().toLowerCase(),
        birth = $("birth-date").value,
        current = $("member-id").value;
    if (!first || !last) return [];
    return members.filter(m => m.id !== current && m.first_name.toLowerCase() === first && m.last_name.toLowerCase() === last && (!birth || m.birth_date === birth));
}

$("member-form").addEventListener("submit", async e => {
    e.preventDefault();
    $("form-error").hidden = true;
    const duplicates = checkDuplicates();
    if (duplicates.length) {
        $("duplicate-warning").innerHTML = `<strong>Possible duplicate detected.</strong> ${duplicates.map(m=>esc(fullName(m))).join(", ")}. Please verify this is a different person before saving.`;
        $("duplicate-warning").hidden = false;
    }
    const override = $("status-override").value;
    const reason = $("override-reason").value.trim();
    if (isAdmin && override && !reason) {
        $("form-error").textContent = "Please provide a reason for the status override.";
        $("form-error").hidden = false;
        return;
    }
    const payload = {
        first_name: $("first-name").value.trim(),
        middle_name: $("middle-name").value.trim() || null,
        last_name: $("last-name").value.trim(),
        nickname: $("nickname").value.trim() || null,
        suffix: $("suffix").value.trim() || null,
        gender: $("gender").value || null,
        birth_date: $("birth-date").value || null,
        year_joined: $("year-joined").value ? Number($("year-joined").value) : null,
        address: $("address").value.trim() || null,
        kapisanan_id: $("kapisanan").value || null,
        is_visitor: $("is-visitor").checked,
        is_unlisted: $("is-unlisted").checked || $("is-visitor").checked,
        remarks: $("remarks").value.trim() || null,
        updated_by: session.user.id
    };
    if (isAdmin) {
        payload.status_override = override || null;
        payload.status_override_reason = override ? reason : null;
        payload.status_override_by = override ? session.user.id : null;
        payload.status_override_at = override ? new Date().toISOString() : null;
    }
    const id = $("member-id").value;
    if (!id) payload.created_by = session.user.id;
    const button = $("save-member");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
        const result = id ? await supabase.from("members").update(payload).eq("id", id).select("id").single() : await supabase.from("members").insert(payload).select("id").single();
        if (result.error) throw result.error;
        closeModal("member-modal");
        showToast(id ? "Member updated successfully." : "Member added successfully.", "success");
        await loadMembers();
    } catch (error) {
        console.error("Save member failed", error);
        $("form-error").textContent = error.message || "Unable to save member.";
        $("form-error").hidden = false;
    } finally {
        button.disabled = false;
        button.textContent = id ? "Save changes" : "Save member";
    }
});

async function showProfile(id) {
    const m = members.find(x => x.id === id);
    if (!m) return;
    profileTarget = m;
    $("profile-name").textContent = fullName(m);
    $("profile-subtitle").textContent = [m.nickname ? `Nickname: ${m.nickname}` : null, m.kapisanan_code || "Unassigned", statusLabel(m.membership_status)].filter(Boolean).join(" · ");
    const details = [
        ["Gender", m.gender || "—"],
        ["Birth date", fmtDate(m.birth_date)],
        ["Address", m.address || "—"],
        ["Year joined", m.year_joined || "—"],
        ["Kapisanan", m.kapisanan_name || "Unassigned"],
        ["Member type", m.is_visitor ? "Visitor" : "Regular member"],
        ["Directory listing", m.is_unlisted ? "Unlisted" : "Listed"],
        ["Membership status", statusLabel(m.membership_status)],
        ["Status method", m.status_override ? `Administrator override: ${m.status_override_reason||"No reason"}` : "Automatic attendance-based status"],
        ["Last attendance", fmtDate(m.last_attendance_date)],
        ["Remarks", m.remarks || "—"]
    ];
    $("profile-details").innerHTML = details.map(([k, v]) => `<div class="detail-item"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join("");
    $("profile-attendance").textContent = "Loading attendance…";
    $("profile-modal").hidden = false;
    $("profile-edit").hidden = !canWrite;
    const {
        data,
        error
    } = await supabase.from("attendance_records").select("id,created_at,attendance_events(event_name,event_type,event_date)").eq("member_id", id).order("created_at", {
        ascending: false
    }).limit(10);
    if (error) {
        $("profile-attendance").textContent = "Attendance history unavailable.";
        console.warn(error);
        return;
    }
    const rows = (data || []).filter(r => r.attendance_events).map(r => `<div class="attendance-history-row"><strong>${esc(r.attendance_events.event_name)}</strong><span>${fmtDate(r.attendance_events.event_date)}</span></div>`).join("");
    $("profile-attendance").innerHTML = rows || '<p class="muted-cell">No attendance records yet.</p>';
}

$("members-body").addEventListener("click", e => {
    const view = e.target.closest("[data-view]"),
        edit = e.target.closest("[data-edit]"),
        archive = e.target.closest("[data-archive]");
    if (view) showProfile(view.dataset.view);
    if (edit) {
        const m = members.find(x => x.id === edit.dataset.edit);
        if (m) openForm(m);
    }
    if (archive) {
        archiveTarget = members.find(x => x.id === archive.dataset.archive) || null;
        if (archiveTarget) {
            $("archive-message").textContent = `${fullName(archiveTarget)} will be hidden from the active directory. Attendance history will be preserved.`;
            $("archive-modal").hidden = false;
        }
    }
});
$("confirm-archive").addEventListener("click", async () => {
    if (!archiveTarget) return;
    const b = $("confirm-archive");
    b.disabled = true;
    b.textContent = "Archiving…";
    try {
        const {
            error
        } = await supabase.from("members").update({
            is_archived: true,
            archived_at: new Date().toISOString(),
            updated_by: session.user.id
        }).eq("id", archiveTarget.id);
        if (error) throw error;
        closeModal("archive-modal");
        showToast("Member archived. Attendance history was preserved.", "success");
        archiveTarget = null;
        await loadMembers();
    } catch (error) {
        showToast(error.message || "Unable to archive member.", "error");
    } finally {
        b.disabled = false;
        b.textContent = "Archive member";
    }
});

$("profile-edit").addEventListener("click", () => {
    const m = profileTarget;
    closeModal("profile-modal");
    if (m) openForm(m);
});
$("add-member").addEventListener("click", () => openForm());
$("empty-add").addEventListener("click", () => openForm());
for (const id of ["member-search", "filter-kapisanan", "filter-status", "filter-type"]) $(id).addEventListener(id === "member-search" ? "input" : "change", render);
$("refresh-members").addEventListener("click", loadMembers);
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.close)));
for (const id of ["member-modal", "profile-modal", "archive-modal"]) $(id).addEventListener("click", e => {
    if (e.target.id === id) closeModal(id);
});
const sidebar = $("sidebar"),
    scrim = $("mobile-scrim");

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
document.querySelectorAll(".coming-soon").forEach(button => button.addEventListener("click", event => {
    event.preventDefault();
    showToast(`${button.dataset.module||"This section"} will be available in a later module.`);
}));
$("logout-button").addEventListener("click", async () => {
    const b = $("logout-button");
    b.disabled = true;
    const {
        error
    } = await supabase.auth.signOut();
    if (error) {
        showToast(error.message, "error");
        b.disabled = false;
        return;
    }
    location.replace("./login.html");
});

try {
    await loadReferenceData();
    await loadMembers();
} catch (error) {
    console.error(error);
    $("page-error").textContent = `Unable to initialize Members: ${error.message||"Please refresh."}`;
    $("page-error").hidden = false;
}