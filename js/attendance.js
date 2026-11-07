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

const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
} [c]));
const fmtDate = v => v ? new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
}).format(new Date(`${v}T00:00:00+08:00`)) : "—";
const fmtType = v => ({
    sunday_service: "Sunday Service",
    midweek_service: "Midweek Service",
    prayer_meeting: "Prayer Meeting",
    youth_fellowship: "Youth Fellowship",
    special_event: "Special Event",
    other: "Other"
} [v] || v || "Other");
const fullName = m => [m.first_name, m.middle_name, m.last_name, m.suffix].filter(Boolean).join(" ");
const todayPH = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
}).format(new Date());

watchAuthState();
const auth = await requireActiveSession();
if (!auth) throw new Error("No active session");
const {
    profile,
    session
} = auth;
const canRead = can(profile, "attendance.read");
const canWrite = can(profile, "attendance.write");
if (!canRead) throw new Error("You do not have permission to view attendance.");
$("top-username").textContent = profile.username;
$("top-role").textContent = profile.role.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
$("user-avatar").textContent = profile.username.slice(0, 1).toUpperCase();
$("today-label").textContent = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila"
}).format(new Date());
if (profile.role !== "administrator") {
    $("admin-nav-label").hidden = true;
    $("admin-nav").hidden = true;
}
if (!canWrite) {
    $("create-event").hidden = true;
    $("add-visitor").hidden = true;
    $("edit-event").hidden = true;
    $("archive-event").hidden = true;
    document.querySelector(".encoder-toolbar").hidden = true;
    document.querySelector(".member-picker-wrap").hidden = true;
}

let events = [],
    members = [],
    records = [],
    selectedEvent = null;
const memberMap = new Map();

function setError(message) {
    $("page-error").textContent = message;
    $("page-error").hidden = !message;
}

function closeModal(id) {
    $(id).hidden = true;
}

function openEventForm(event = null) {
    if (!canWrite) return;
    $("event-form").reset();
    $("event-form-error").hidden = true;
    $("event-id").value = event?.id || "";
    $("event-modal-title").textContent = event ? "Edit event" : "Create event";
    $("save-event").textContent = event ? "Save changes" : "Create event";
    $("event-name").value = event?.event_name || "";
    $("event-type").value = event?.event_type || "sunday_service";
    $("custom-event-type").value = event?.custom_event_type || "";
    $("event-date").value = event?.event_date || todayPH();
    $("event-time").value = event?.start_time?.slice(0, 5) || "";
    $("event-location").value = event?.location || "";
    $("event-remarks").value = event?.remarks || "";
    toggleCustomType();
    $("event-modal").hidden = false;
    $("event-name").focus();
}

function toggleCustomType() {
    const other = $("event-type").value === "other";
    $("custom-type-wrap").hidden = !other;
    $("custom-event-type").required = other;
}

function renderEvents() {
    const q = $("event-search").value.trim().toLowerCase(),
        type = $("event-type-filter").value;
    const shown = events.filter(e => (!type || e.event_type === type) && (!q || `${e.event_name} ${e.custom_event_type||""} ${e.location||""}`.toLowerCase().includes(q)));
    if (!shown.length) {
        $("event-list").innerHTML = '<div class="list-placeholder">No events found. Create an event to get started.</div>';
        return;
    }
    $("event-list").innerHTML = shown.map(e => `<button class="event-card ${selectedEvent?.id===e.id?"selected":""}" data-event="${esc(e.id)}"><strong>${esc(e.event_name)}</strong><span class="event-card-meta"><small>${fmtDate(e.event_date)}</small><span class="event-type-pill">${esc(e.event_type==="other"?e.custom_event_type:fmtType(e.event_type))}</span></span><span class="event-card-count">${Number(e.attendance_count||0)} present</span></button>`).join("");
}
async function loadEvents() {
    const b = $("refresh-events");
    b.disabled = true;
    try {
        const {
            data,
            error
        } = await supabase.from("attendance_events").select("id,event_name,event_type,custom_event_type,event_date,start_time,location,remarks,is_archived,created_at").eq("is_archived", false).order("event_date", {
            ascending: false
        }).order("created_at", {
            ascending: false
        }).limit(500);
        if (error) throw error;
        events = data || [];
        const ids = events.map(e => e.id);
        if (ids.length) {
            const {
                data: counts,
                error: countError
            } = await supabase.from("attendance_records").select("event_id").in("event_id", ids);
            if (countError) throw countError;
            const map = {};
            (counts || []).forEach(r => map[r.event_id] = (map[r.event_id] || 0) + 1);
            events.forEach(e => e.attendance_count = map[e.id] || 0);
        }
        if (selectedEvent) {
            selectedEvent = events.find(e => e.id === selectedEvent.id) || null;
            if (selectedEvent) await loadRecords();
            else showNoEvent();
        }
        renderEvents();
    } catch (error) {
        console.error(error);
        setError(`Unable to load events: ${error.message||"Please try again."}`);
        showToast("Unable to load attendance events.", "error");
    } finally {
        b.disabled = false;
    }
}
async function loadMembers() {
    const {
        data,
        error
    } = await supabase.from("member_directory").select("id,first_name,middle_name,last_name,nickname,suffix,gender,address,kapisanan_id,kapisanan_code,kapisanan_name,is_visitor,is_unlisted,is_archived,membership_status").eq("is_archived", false).order("last_name").order("first_name").limit(3000);
    if (error) throw error;
    members = data || [];
    members.forEach(m => memberMap.set(m.id, m));

    console.log("Attendance members:", data);
    console.log("Attendance member error:", error);
}

function showNoEvent() {
    $("event-workspace").hidden = true;
    $("no-event").hidden = false;
    selectedEvent = null;
    records = [];
    renderEvents();
}
async function selectEvent(id) {
    const e = events.find(x => x.id === id);
    if (!e) return;
    selectedEvent = e;
    $("no-event").hidden = true;
    $("event-workspace").hidden = false;
    $("member-search").value = "";
    renderEvents();
    await loadRecords();
}
async function loadRecords() {
    if (!selectedEvent) return;
    const {
        data,
        error
    } = await supabase.from("attendance_records").select("id,event_id,member_id,recorded_by,remarks,created_at").eq("event_id", selectedEvent.id).order("created_at", {
        ascending: true
    });
    if (error) throw error;
    records = data || [];
    const missing = records.map(r => r.member_id).filter(id => !memberMap.has(id));
    if (missing.length) {
        const {
            data: found,
            error: memberError
        } = await supabase.from("member_directory").select("id,first_name,middle_name,last_name,nickname,suffix,kapisanan_code,kapisanan_name,is_visitor,is_unlisted").in("id", missing);
        if (memberError) throw memberError;
        (found || []).forEach(m => memberMap.set(m.id, m));
    }
    renderSelectedEvent();
}

function renderSelectedEvent() {
    if (!selectedEvent) return;
    $("selected-event-name").textContent = selectedEvent.event_name;
    const type = selectedEvent.event_type === "other" ? selectedEvent.custom_event_type : fmtType(selectedEvent.event_type);
    $("selected-event-meta").textContent = [fmtDate(selectedEvent.event_date), type, selectedEvent.start_time ? selectedEvent.start_time.slice(0, 5) : null, selectedEvent.location].filter(Boolean).join(" · ");
    const people = records.map(r => ({
        ...r,
        member: memberMap.get(r.member_id)
    })).filter(r => r.member);
    const visitors = people.filter(r => r.member.is_visitor),
        regular = people.filter(r => !r.member.is_visitor);
    $("present-count").textContent = people.length;
    $("regular-count").textContent = regular.length;
    $("visitor-count").textContent = visitors.length;
    $("attendance-result-count").textContent = `${people.length} ${people.length===1?"person":"people"}`;
    const groups = {};
    people.forEach(r => {
        const k = r.member.kapisanan_code || "Unassigned";
        groups[k] = (groups[k] || 0) + 1;
    });
    $("kapisanan-summary").innerHTML = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `<span class="kapisanan-chip">${esc(k)} <strong>${v}</strong></span>`).join("") || '<span class="kapisanan-chip">No attendance recorded</span>';
    $("attendance-list").innerHTML = people.length ? people.map(r => {
        const m = r.member;
        return `<div class="attendance-person"><span class="person-avatar">${esc((m.first_name||"?").slice(0,1).toUpperCase())}</span><span class="person-copy"><strong>${esc(fullName(m))}</strong><small>${esc(m.kapisanan_code||"Unassigned")} · ${m.is_visitor?"Visitor":"Member"}</small></span>${m.is_visitor?'<span class="person-type">Visitor</span>':""}${canWrite?`<button class="remove-attendance" data-remove="${esc(r.id)}" aria-label="Remove ${esc(fullName(m))}">Remove</button>`:""}</div>`;
    }).join("") : '<div class="list-placeholder">No one has been marked present yet.</div>';
    renderPicker();
}

function renderPicker() {
    const q = $("member-search").value.trim().toLowerCase();
    if (!q) {
        $("member-picker").innerHTML = '<div class="list-placeholder">Search for a member above to add them.</div>';
        return;
    }
    const already = new Set(records.map(r => r.member_id));
    const matches = members.filter(m => !already.has(m.id) && `${m.first_name} ${m.middle_name||""} ${m.last_name} ${m.nickname||""} ${m.kapisanan_code||""}`.toLowerCase().includes(q)).slice(0, 40);
    $("member-picker").innerHTML = matches.length ? matches.map(m => `<button class="picker-person" data-add-member="${esc(m.id)}"><span class="person-avatar">${esc((m.first_name||"?").slice(0,1).toUpperCase())}</span><span class="person-copy"><strong>${esc(fullName(m))}</strong><small>${esc(m.kapisanan_code||"Unassigned")} · ${m.is_visitor?"Visitor":"Member"}</small></span><span class="picker-add">＋</span></button>`).join("") : '<div class="list-placeholder">No matching members available.</div>';
}
async function addAttendance(memberId) {
    if (!canWrite || !selectedEvent) return;
    try {
        const {
            error
        } = await supabase.from("attendance_records").insert({
            event_id: selectedEvent.id,
            member_id: memberId,
            recorded_by: session.user.id
        });
        if (error) {
            if (error.code === "23505") {
                showToast("This person is already marked present.", "info");
                return;
            }
            throw error;
        }
        await loadRecords();
        await loadEvents();
        showToast("Attendance recorded.", "success");
    } catch (error) {
        console.error(error);
        showToast(error.message || "Unable to record attendance.", "error");
    }
}
async function removeAttendance(id) {
    if (!canWrite || !confirm("Remove this attendance record?")) return;
    try {
        const {
            error
        } = await supabase.from("attendance_records").delete().eq("id", id);
        if (error) throw error;
        await loadRecords();
        await loadEvents();
        showToast("Attendance record removed.", "success");
    } catch (error) {
        showToast(error.message || "Unable to remove attendance.", "error");
    }
}

$("create-event").addEventListener("click", () => openEventForm());
$("event-type").addEventListener("change", toggleCustomType);
$("event-search").addEventListener("input", renderEvents);
$("event-type-filter").addEventListener("change", renderEvents);
$("refresh-events").addEventListener("click", loadEvents);
$("event-list").addEventListener("click", async e => {
    const b = e.target.closest("[data-event]");
    if (b) {
        try {
            await selectEvent(b.dataset.event);
        } catch (error) {
            showToast(error.message || "Unable to load event attendance.", "error");
        }
    }
});
$("event-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!canWrite) return;
    const id = $("event-id").value,
        other = $("event-type").value === "other",
        custom = $("custom-event-type").value.trim();
    if (other && !custom) {
        $("event-form-error").textContent = "Enter a custom event type.";
        $("event-form-error").hidden = false;
        return;
    }
    const payload = {
        event_name: $("event-name").value.trim(),
        event_type: $("event-type").value,
        custom_event_type: other ? custom : null,
        event_date: $("event-date").value,
        start_time: $("event-time").value || null,
        location: $("event-location").value.trim() || null,
        remarks: $("event-remarks").value.trim() || null,
        updated_by: session.user.id
    };
    if (!id) payload.created_by = session.user.id;
    const b = $("save-event");
    b.disabled = true;
    b.textContent = "Saving…";
    try {
        const result = id ? await supabase.from("attendance_events").update(payload).eq("id", id).select("id").single() : await supabase.from("attendance_events").insert(payload).select("id").single();
        if (result.error) throw result.error;
        closeModal("event-modal");
        showToast(id ? "Event updated." : "Event created.", "success");
        await loadEvents();
        if (!id && result.data?.id) await selectEvent(result.data.id);
        else if (selectedEvent?.id === id) {
            selectedEvent = events.find(x => x.id === id) || selectedEvent;
            renderSelectedEvent();
        }
    } catch (error) {
        $("event-form-error").textContent = error.message || "Unable to save event.";
        $("event-form-error").hidden = false;
    } finally {
        b.disabled = false;
        b.textContent = id ? "Save changes" : "Create event";
    }
});
$("edit-event").addEventListener("click", () => selectedEvent && openEventForm(selectedEvent));
$("archive-event").addEventListener("click", () => {
    if (selectedEvent) $("archive-modal").hidden = false;
});
$("confirm-archive").addEventListener("click", async () => {
    if (!selectedEvent || !canWrite) return;
    const b = $("confirm-archive");
    b.disabled = true;
    b.textContent = "Archiving…";
    try {
        const {
            error
        } = await supabase.from("attendance_events").update({
            is_archived: true,
            archived_at: new Date().toISOString(),
            updated_by: session.user.id
        }).eq("id", selectedEvent.id);
        if (error) throw error;
        closeModal("archive-modal");
        showToast("Event archived. Attendance history was preserved.", "success");
        showNoEvent();
        await loadEvents();
    } catch (error) {
        showToast(error.message || "Unable to archive event.", "error");
    } finally {
        b.disabled = false;
        b.textContent = "Archive event";
    }
});
$("member-search").addEventListener("input", renderPicker);
$("member-picker").addEventListener("click", e => {
    const b = e.target.closest("[data-add-member]");
    if (b) addAttendance(b.dataset.addMember);
});
$("attendance-list").addEventListener("click", e => {
    const b = e.target.closest("[data-remove]");
    if (b) removeAttendance(b.dataset.remove);
});
$("add-visitor").addEventListener("click", () => {
    if (!canWrite || !selectedEvent) return;
    $("visitor-form").reset();
    $("visitor-form-error").hidden = true;
    $("visitor-modal").hidden = false;
    $("visitor-first").focus();
});
$("visitor-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!canWrite || !selectedEvent) return;
    const b = $("save-visitor");
    b.disabled = true;
    b.textContent = "Adding…";
    try {
        const payload = {
            first_name: $("visitor-first").value.trim(),
            last_name: $("visitor-last").value.trim(),
            nickname: $("visitor-nickname").value.trim() || null,
            gender: $("visitor-gender").value || null,
            address: $("visitor-address").value.trim() || null,
            remarks: $("visitor-remarks").value.trim() || null,
            is_visitor: true,
            is_unlisted: true,
            created_by: session.user.id,
            updated_by: session.user.id
        };
        const {
            data: member,
            error: memberError
        } = await supabase.from("members").insert(payload).select("id").single();
        if (memberError) throw memberError;
        const {
            error: recordError
        } = await supabase.from("attendance_records").insert({
            event_id: selectedEvent.id,
            member_id: member.id,
            recorded_by: session.user.id
        });
        if (recordError) throw recordError;
        closeModal("visitor-modal");
        await loadMembers();
        await loadRecords();
        await loadEvents();
        showToast("Visitor added and marked present.", "success");
    } catch (error) {
        $("visitor-form-error").textContent = error.message || "Unable to add visitor.";
        $("visitor-form-error").hidden = false;
    } finally {
        b.disabled = false;
        b.textContent = "Add and mark present";
    }
});

document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.close)));
for (const id of ["event-modal", "visitor-modal", "archive-modal"]) $(id).addEventListener("click", e => {
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
    await loadMembers();
    await loadEvents();
} catch (error) {
    console.error(error);
    setError(`Unable to initialize Attendance: ${error.message||"Please refresh."}`);
}