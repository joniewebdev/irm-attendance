
import { supabase } from "./supabase-client.js";

const $ = id => document.getElementById(id);

const EVENT_TYPES = {
    sunday_service: "Sunday Service",
    midweek_service: "Midweek Service",
    prayer_meeting: "Prayer Meeting",
    youth_fellowship: "Youth Fellowship",
    special_event: "Special Event",
    other: "Other"
};

const REPORT_INFO = {
    event: ["Event attendance", "Attendance summary for each event."],
    daily: ["Daily attendance", "Attendance grouped by calendar date."],
    weekly: ["Weekly attendance", "Attendance grouped by week."],
    monthly: ["Monthly attendance", "Attendance grouped by month."],
    kapisanan: ["By Kapisanan", "Attendance grouped by Kapisanan."],
    individual: ["Individual attendance", "Attendance history for each member."],
    frequent: ["Frequent attendees", "Members with the highest attendance."],
    "no-attendance": ["No attendance", "Members without attendance during the selected period."],
    visitors: ["Visitor attendance", "Attendance records for visitors."]
};

let currentUser = null;
let events = [];
let members = [];
let records = [];
let eventMap = new Map();
let memberMap = new Map();
let reportRows = [];

const localDate = date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[char]));

const fullName = member => [
    member.first_name,
    member.middle_name,
    member.last_name,
    member.suffix
].filter(Boolean).join(" ");

const normalize = value => String(value ?? "").trim().toLowerCase();

const formatDate = value => {
    if (!value) return "—";

    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
};

const formatMonth = value => {
    const [year, month] = value.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric"
    });
};

const showToast = (message, type = "info") => {
    let region = $("report-toast-region");

    if (!region) {
        region = document.createElement("div");
        region.id = "report-toast-region";
        region.className = "toast-region";
        document.body.appendChild(region);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    region.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
};

function setLoading(message) {
    $("filter-status").textContent = message;
    $("apply-filters").disabled = true;
    $("refresh-btn").disabled = true;
}

function clearLoading() {
    $("filter-status").textContent = "Ready";
    $("apply-filters").disabled = false;
    $("refresh-btn").disabled = false;
}

async function initializeAuth() {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (!session) {
        window.location.replace("./index.html");
        return false;
    }

    const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("user_id,username,role,account_status")
        .eq("user_id", session.user.id)
        .maybeSingle();

    if (profileError) throw profileError;

    if (!profile || profile.account_status !== "active") {
        await supabase.auth.signOut();
        window.location.replace("./index.html");
        return false;
    }

    if (!["administrator", "attendance_encoder", "viewer"].includes(profile.role)) {
        window.location.replace("./dashboard.html");
        return false;
    }

    currentUser = profile;

    $("top-username").textContent = profile.username || "User";
    $("user-avatar").textContent = (profile.username || "U").charAt(0).toUpperCase();
    $("top-role").textContent = profile.role.replaceAll("_", " ");

    return true;
}

async function loadReportData() {
    const from = $("date-from").value;
    const to = $("date-to").value;

    if (!from || !to) {
        throw new Error("Please select both start and end dates.");
    }

    if (from > to) {
        throw new Error("The start date cannot be later than the end date.");
    }

    const [eventResult, memberResult] = await Promise.all([
        supabase
            .from("attendance_events")
            .select("id,event_name,event_type,custom_event_type,event_date,start_time,location,is_archived")
            .eq("is_archived", false)
            .gte("event_date", from)
            .lte("event_date", to)
            .order("event_date", { ascending: false }),

        supabase
            .from("member_directory")
            .select("id,first_name,middle_name,last_name,nickname,suffix,gender,kapisanan_id,kapisanan_code,kapisanan_name,is_visitor,is_unlisted,is_archived,membership_status")
            .eq("is_archived", false)
            .order("last_name")
            .order("first_name")
            .limit(5000)
    ]);

    if (eventResult.error) throw eventResult.error;
    if (memberResult.error) throw memberResult.error;

    events = eventResult.data || [];
    members = memberResult.data || [];

    eventMap = new Map(events.map(event => [event.id, event]));
    memberMap = new Map(members.map(member => [member.id, member]));

    if (!events.length) {
        records = [];
        populateFilterOptions();
        return;
    }

    const eventIds = events.map(event => event.id);

    const recordResult = await supabase
        .from("attendance_records")
        .select("id,event_id,member_id,recorded_by,remarks,created_at")
        .in("event_id", eventIds)
        .order("created_at", { ascending: true });

    if (recordResult.error) throw recordResult.error;

    records = recordResult.data || [];

    populateFilterOptions();
}

function populateFilterOptions() {
    const eventSelect = $("event-filter");
    const previousEvent = eventSelect.value;

    eventSelect.innerHTML = '<option value="">All events</option>';

    events.forEach(event => {
        const option = document.createElement("option");
        option.value = event.id;
        option.textContent = `${formatDate(event.event_date)} — ${event.event_name}`;
        eventSelect.appendChild(option);
    });

    if (events.some(event => event.id === previousEvent)) {
        eventSelect.value = previousEvent;
    }

    const kapisananSelect = $("kapisanan-filter");
    const previousKapisanan = kapisananSelect.value;

    const kapisananNames = [...new Set(
        members.map(member => member.kapisanan_name).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    kapisananSelect.innerHTML = '<option value="">All Kapisanan</option>';

    kapisananNames.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        kapisananSelect.appendChild(option);
    });

    if (kapisananNames.includes(previousKapisanan)) {
        kapisananSelect.value = previousKapisanan;
    }
}

function getFilteredData() {
    const eventType = $("event-type").value;
    const eventId = $("event-filter").value;
    const kapisanan = $("kapisanan-filter").value;
    const gender = $("gender-filter").value;
    const status = $("status-filter").value;

    const filteredEvents = events.filter(event =>
        (!eventType || event.event_type === eventType) &&
        (!eventId || event.id === eventId)
    );

    const allowedEventIds = new Set(filteredEvents.map(event => event.id));

    const filteredRecords = records.filter(record => {
        if (!allowedEventIds.has(record.event_id)) return false;

        const member = memberMap.get(record.member_id);
        if (!member) return false;

        if (kapisanan && member.kapisanan_name !== kapisanan) return false;
        if (gender && normalize(member.gender) !== gender) return false;
        if (status && normalize(member.membership_status) !== status) return false;

        return true;
    });

    return { filteredEvents, filteredRecords };
}

function getWeekStart(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    const dayOfWeek = date.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    date.setDate(date.getDate() + diff);
    return localDate(date);
}

function renderSummary(filteredEvents, filteredRecords) {
    const uniquePeople = new Set(filteredRecords.map(record => record.member_id));

    $("summary-events").textContent = filteredEvents.length;
    $("summary-attendance").textContent = filteredRecords.length;
    $("summary-unique").textContent = uniquePeople.size;

    $("summary-average").textContent = filteredEvents.length
        ? (filteredRecords.length / filteredEvents.length).toFixed(1)
        : "0";
}

function createRows(type, filteredEvents, filteredRecords) {
    const grouped = new Map();

    const add = (key, data) => {
        if (!grouped.has(key)) grouped.set(key, data);
        return grouped.get(key);
    };

    if (type === "no-attendance") {
        const attended = new Set(filteredRecords.map(record => record.member_id));

        return members
            .filter(member => !member.is_visitor)
            .filter(member => !attended.has(member.id))
            .filter(member => {
                const kapisanan = $("kapisanan-filter").value;
                const gender = $("gender-filter").value;
                const status = $("status-filter").value;

                return (!kapisanan || member.kapisanan_name === kapisanan) &&
                    (!gender || normalize(member.gender) === gender) &&
                    (!status || normalize(member.membership_status) === status);
            })
            .map(member => ({
                name: fullName(member),
                kapisanan: member.kapisanan_name || "Unassigned",
                gender: member.gender || "—",
                status: member.membership_status || "—",
                lastAttendance: member.last_attendance_date
                    ? formatDate(member.last_attendance_date)
                    : "No recorded attendance"
            }));
    }

    filteredRecords.forEach(record => {
        const event = eventMap.get(record.event_id);
        const member = memberMap.get(record.member_id);

        if (!event || !member) return;

        const isVisitor = Boolean(member.is_visitor);
        const name = fullName(member);
        const kapisanan = member.kapisanan_name || "Unassigned";

        if (type === "event") {
            const row = add(event.id, {
                event: event.event_name,
                date: event.event_date,
                type: event.event_type === "other"
                    ? event.custom_event_type
                    : EVENT_TYPES[event.event_type] || event.event_type,
                total: 0,
                members: 0,
                visitors: 0
            });

            row.total++;
            isVisitor ? row.visitors++ : row.members++;
        }

        if (type === "daily") {
            const row = add(event.event_date, {
                date: event.event_date,
                total: 0,
                events: new Set()
            });

            row.total++;
            row.events.add(event.id);
        }

        if (type === "weekly") {
            const week = getWeekStart(event.event_date);
            const row = add(week, {
                week,
                total: 0,
                events: new Set()
            });

            row.total++;
            row.events.add(event.id);
        }

        if (type === "monthly") {
            const month = event.event_date.slice(0, 7);
            const row = add(month, {
                month,
                total: 0,
                events: new Set()
            });

            row.total++;
            row.events.add(event.id);
        }

        if (type === "kapisanan") {
            const row = add(kapisanan, {
                kapisanan,
                total: 0,
                members: new Set(),
                visitors: 0
            });

            row.total++;
            row.members.add(member.id);
            if (isVisitor) row.visitors++;
        }

        if (type === "individual" || type === "frequent") {
            const row = add(member.id, {
                name,
                kapisanan,
                gender: member.gender || "—",
                status: member.membership_status || "—",
                total: 0,
                visitor: isVisitor
            });

            row.total++;
        }

        if (type === "visitors" && isVisitor) {
            const row = add(member.id, {
                name,
                kapisanan,
                total: 0,
                events: new Set()
            });

            row.total++;
            row.events.add(event.event_name);
        }
    });

    let rows = [...grouped.values()];

    if (type === "daily") {
        rows = rows.map(row => ({
            date: formatDate(row.date),
            events: row.events.size,
            total: row.total
        }));
    }

    if (type === "weekly") {
        rows = rows.map(row => ({
            week: `${formatDate(row.week)} onward`,
            events: row.events.size,
            total: row.total
        }));
    }

    if (type === "monthly") {
        rows = rows.map(row => ({
            month: formatMonth(row.month),
            events: row.events.size,
            total: row.total
        }));
    }

    if (type === "kapisanan") {
        rows = rows.map(row => ({
            kapisanan: row.kapisanan,
            total: row.total,
            uniquePeople: row.members.size,
            visitorRecords: row.visitors
        }));
    }

    if (type === "individual" || type === "frequent") {
        rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
        rows = rows.map((row, index) => ({
            rank: index + 1,
            name: row.name,
            kapisanan: row.kapisanan,
            gender: row.gender,
            status: row.status,
            attendance: row.total
        }));
    }

    if (type === "visitors") {
        rows = rows.map(row => ({
            name: row.name,
            kapisanan: row.kapisanan,
            attendance: row.total,
            events: [...row.events].join(", ")
        })).sort((a, b) => b.attendance - a.attendance);
    }

    if (type === "event") {
        rows.sort((a, b) => b.date.localeCompare(a.date));
        rows = rows.map(row => ({
            event: row.event,
            date: formatDate(row.date),
            type: row.type,
            total: row.total,
            members: row.members,
            visitors: row.visitors
        }));
    }

    if (type === "no-attendance") {
        rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    return rows;
}

const REPORT_COLUMNS = {
    event: [
        ["event", "Event"],
        ["date", "Date"],
        ["type", "Event type"],
        ["total", "Total"],
        ["members", "Members"],
        ["visitors", "Visitors"]
    ],
    daily: [
        ["date", "Date"],
        ["events", "Events"],
        ["total", "Attendance"]
    ],
    weekly: [
        ["week", "Week starting"],
        ["events", "Events"],
        ["total", "Attendance"]
    ],
    monthly: [
        ["month", "Month"],
        ["events", "Events"],
        ["total", "Attendance"]
    ],
    kapisanan: [
        ["kapisanan", "Kapisanan"],
        ["total", "Attendance records"],
        ["uniquePeople", "Unique people"],
        ["visitorRecords", "Visitor records"]
    ],
    individual: [
        ["name", "Member"],
        ["kapisanan", "Kapisanan"],
        ["gender", "Gender"],
        ["status", "Status"],
        ["attendance", "Attendance"]
    ],
    frequent: [
        ["rank", "Rank"],
        ["name", "Member"],
        ["kapisanan", "Kapisanan"],
        ["attendance", "Attendance"]
    ],
    "no-attendance": [
        ["name", "Member"],
        ["kapisanan", "Kapisanan"],
        ["gender", "Gender"],
        ["status", "Status"],
        ["lastAttendance", "Last attendance"]
    ],
    visitors: [
        ["name", "Visitor"],
        ["kapisanan", "Kapisanan"],
        ["attendance", "Attendance"],
        ["events", "Events attended"]
    ]
};

function renderTable(rows, type) {
    const columns = REPORT_COLUMNS[type];

    $("report-thead").innerHTML = `
        <tr>
            ${columns.map(([, label]) => `<th>${esc(label)}</th>`).join("")}
        </tr>
    `;

    $("report-tbody").innerHTML = rows.length
        ? rows.map(row => `
            <tr>
                ${columns.map(([key]) => `<td>${esc(row[key] ?? "—")}</td>`).join("")}
            </tr>
        `).join("")
        : `<tr><td colspan="${columns.length}" class="empty-cell">
            No records found for the selected filters.
        </td></tr>`;

    $("results-count").textContent = `${rows.length} records`;
    $("report-footer-count").textContent = `${rows.length} records`;
}

function renderReport() {
    const type = $("report-type").value;
    const { filteredEvents, filteredRecords } = getFilteredData();

    renderSummary(filteredEvents, filteredRecords);

    const rows = createRows(type, filteredEvents, filteredRecords);
    reportRows = rows;

    $("results-title").textContent = REPORT_INFO[type][0];
    $("results-description").textContent = REPORT_INFO[type][1];

    renderTable(rows, type);
}

async function applyFilters() {
    setLoading("Loading report data…");

    try {
        await loadReportData();
        renderReport();
    } catch (error) {
        console.error(error);
        showToast(error.message || "Unable to load reports.", "error");
    } finally {
        clearLoading();
    }
}

function resetFilters() {
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - 29);

    $("date-from").value = localDate(from);
    $("date-to").value = localDate(today);

    $("report-type").value = "event";
    $("event-type").value = "";
    $("event-filter").value = "";
    $("kapisanan-filter").value = "";
    $("gender-filter").value = "";
    $("status-filter").value = "";

    applyFilters();
}

function exportCSV() {
    if (!reportRows.length) {
        showToast("There are no records to export.", "warning");
        return;
    }

    const type = $("report-type").value;
    const columns = REPORT_COLUMNS[type];

    const csvCell = value => {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
    };

    const header = columns.map(([, label]) => csvCell(label)).join(",");

    const body = reportRows.map(row =>
        columns.map(([key]) => csvCell(row[key])).join(",")
    );

    const csv = "\uFEFF" + [header, ...body].join("\r\n");
    const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `IRM-${type}-report-${localDate(new Date())}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    showToast("CSV report exported.", "success");
}

function attachEvents() {
    $("apply-filters").addEventListener("click", applyFilters);
    $("refresh-btn").addEventListener("click", applyFilters);
    $("reset-filters").addEventListener("click", resetFilters);

    $("report-type").addEventListener("change", renderReport);
    $("event-type").addEventListener("change", () => {
        const selectedType = $("event-type").value;
        const eventSelect = $("event-filter");

        [...eventSelect.options].forEach(option => {
            if (!option.value) return;

            const event = eventMap.get(option.value);
            option.hidden = Boolean(
                selectedType && event?.event_type !== selectedType
            );
        });

        if (eventSelect.selectedOptions[0]?.hidden) {
            eventSelect.value = "";
        }

        renderReport();
    });

    [
        "event-filter",
        "kapisanan-filter",
        "gender-filter",
        "status-filter"
    ].forEach(id => {
        $(id).addEventListener("change", renderReport);
    });

    $("export-btn").addEventListener("click", exportCSV);
    $("print-btn").addEventListener("click", () => window.print());

    $("logout-button").addEventListener("click", async () => {
        const { error } = await supabase.auth.signOut();

        if (error) {
            showToast(error.message, "error");
            return;
        }

        window.location.replace("./index.html");
    });

    supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session) {
            window.location.replace("./index.html");
        }
    });

    $("today-label").textContent = new Date().toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Manila"
    });

    const sidebar = $("sidebar");
    const scrim = $("mobile-scrim");
    const menuToggle = $("menu-toggle");

    function closeMenu() {
        sidebar.classList.remove("sidebar-open");
        scrim.hidden = true;
        menuToggle.setAttribute("aria-expanded", "false");
    }

    menuToggle.addEventListener("click", () => {
        const isOpen = sidebar.classList.toggle("sidebar-open");

        scrim.hidden = !isOpen;
        menuToggle.setAttribute("aria-expanded", String(isOpen));
    });

    scrim.addEventListener("click", closeMenu);
}

async function initialize() {
    try {
        const authenticated = await initializeAuth();
        if (!authenticated) return;

        const today = new Date();
        const from = new Date();
        from.setDate(today.getDate() - 29);

        $("date-from").value = localDate(from);
        $("date-to").value = localDate(today);

        attachEvents();

        await applyFilters();

        $("app-loading").hidden = true;
        $("app-content").hidden = false;

    } catch (error) {
        console.error("Reports initialization error:", error);

        $("app-loading").innerHTML = `
            <div class="report-load-error">
                <strong>Unable to load Reports</strong>
                <p>${esc(error.message || "An unexpected error occurred.")}</p>
                <button onclick="location.reload()">Try again</button>
            </div>
        `;
    }
}

initialize();
