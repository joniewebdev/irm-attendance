
import { supabase } from "./supabase-client.js";

/* =========================================
   USER MANAGEMENT
   Read-only administrator directory
   ========================================= */

const $ = (id) => document.getElementById(id);

const state = {
    currentUser: null,
    profile: null,
    users: [],
    filteredUsers: [],
    members: new Map(),
    selectedUser: null,
    loading: false
};

const LOGIN_PAGE = "./login.html";

/* =========================================
   HELPERS
   ========================================= */

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function fullName(member) {
    if (!member) return "Unlinked member";

    return [
        member.first_name,
        member.middle_name,
        member.last_name,
        member.suffix
    ].filter(Boolean).join(" ") || "Unnamed member";
}

function roleLabel(role) {
    const labels = {
        administrator: "Administrator",
        attendance_encoder: "Attendance Encoder",
        viewer: "Viewer"
    };

    return labels[role] || role || "Unknown";
}

function statusLabel(status) {
    const labels = {
        active: "Active",
        pending: "Pending",
        disabled: "Disabled",
        revoked: "Revoked"
    };

    return labels[status] || status || "Unknown";
}

function roleClass(role) {
    return `role-${escapeHTML(role || "unknown")}`;
}

function statusClass(status) {
    return `status-${escapeHTML(status || "unknown")}`;
}

function formatDate(value, includeTime = false) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    const options = {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric"
    };

    if (includeTime) {
        options.hour = "2-digit";
        options.minute = "2-digit";
        options.hour12 = true;
    }

    return new Intl.DateTimeFormat("en-PH", options).format(date);
}

function showToast(message, type = "info") {
    const region = $("toast-region");
    if (!region) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    region.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    window.setTimeout(() => {
        toast.classList.remove("show");
        window.setTimeout(() => toast.remove(), 250);
    }, 3000);
}

function showPageError(message) {
    const element = $("page-error");
    if (!element) return;

    element.textContent = message;
    element.hidden = false;
}

function clearPageError() {
    const element = $("page-error");
    if (!element) return;

    element.textContent = "";
    element.hidden = true;
}

function setLoading(loading) {
    state.loading = loading;

    const button = $("refresh-users");
    if (button) {
        button.disabled = loading;
        button.textContent = loading ? "↻ Loading…" : "↻ Refresh";
    }

    if (loading) {
        $("users-body").innerHTML = `
            <tr>
                <td colspan="8" class="table-empty">
                    Loading user accounts…
                </td>
            </tr>
        `;

        $("result-count").textContent = "Loading accounts…";
    }
}

/* =========================================
   AUTHENTICATION AND AUTHORIZATION
   ========================================= */

async function initializeAuth() {
    const {
        data: { session },
        error
    } = await supabase.auth.getSession();

    if (error) throw error;

    if (!session?.user) {
        window.location.replace(LOGIN_PAGE);
        return false;
    }

    state.currentUser = session.user;

    const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select(`
            user_id,
            member_id,
            username,
            role,
            account_status
        `)
        .eq("user_id", session.user.id)
        .maybeSingle();

    if (profileError) throw profileError;

    if (!profile || profile.account_status !== "active") {
        await supabase.auth.signOut();
        window.location.replace(LOGIN_PAGE);
        return false;
    }

    if (profile.role !== "administrator") {
        $("app-loading").innerHTML = `
            <strong>Access denied</strong>
            <span>This page is available to administrators only.</span>
            <a href="./dashboard.html">Return to dashboard</a>
        `;

        return false;
    }

    state.profile = profile;

    updateUserInterface(profile);

    $("app-loading").hidden = true;
    $("app-content").hidden = false;

    return true;
}

function updateUserInterface(profile) {
    const username = profile.username || "Administrator";

    $("top-username").textContent = username;
    $("top-role").textContent = roleLabel(profile.role);
    $("user-avatar").textContent = username.charAt(0).toUpperCase();

    $("today-label").textContent = new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(new Date());
}

/* =========================================
   LOAD USER ACCOUNTS
   ========================================= */

async function loadUsers() {
    if (state.loading) return;

    setLoading(true);
    clearPageError();

    try {
        /*
         * RLS allows administrators to read all profiles.
         * Non-administrators are denied by initializeAuth().
         */
        const { data: profiles, error: profileError } = await supabase
            .from("user_profiles")
            .select(`
                user_id,
                member_id,
                username,
                email,
                role,
                account_status,
                registered_at,
                last_login_at,
                created_at,
                invited_by
            `)
            .order("created_at", { ascending: false });

        if (profileError) throw profileError;

        const memberIds = [
            ...new Set(
                (profiles || [])
                    .map((profile) => profile.member_id)
                    .filter(Boolean)
            )
        ];

        let memberMap = new Map();

        if (memberIds.length > 0) {
            const { data: members, error: memberError } = await supabase
                .from("member_directory")
                .select(`
                    id,
                    first_name,
                    middle_name,
                    last_name,
                    suffix,
                    nickname,
                    kapisanan_code,
                    kapisanan_name
                `)
                .in("id", memberIds);

            if (memberError) throw memberError;

            memberMap = new Map(
                (members || []).map((member) => [member.id, member])
            );
        }

        state.members = memberMap;

        state.users = (profiles || []).map((profile) => ({
            ...profile,
            member: memberMap.get(profile.member_id) || null
        }));

        updateSummary();
        applyFilters();

    } catch (error) {
        console.error("Unable to load user accounts:", error);

        showPageError(
            error.message || "Unable to load user accounts. Please try again."
        );

        $("users-body").innerHTML = `
            <tr>
                <td colspan="8" class="table-empty">
                    Unable to load user accounts.
                </td>
            </tr>
        `;

        $("result-count").textContent = "Unable to load accounts";

    } finally {
        setLoading(false);
    }
}

/* =========================================
   SUMMARY CARDS
   ========================================= */

function updateSummary() {
    const users = state.users;

    $("count-total").textContent = users.length;

    $("count-active").textContent = users.filter(
        (user) => user.account_status === "active"
    ).length;

    $("count-pending").textContent = users.filter(
        (user) => user.account_status === "pending"
    ).length;

    $("count-disabled").textContent = users.filter(
        (user) => user.account_status === "disabled"
    ).length;
}

/* =========================================
   SEARCH AND FILTERS
   ========================================= */

function applyFilters() {
    const search = $("user-search").value.trim().toLowerCase();
    const role = $("filter-role").value;
    const status = $("filter-status").value;

    state.filteredUsers = state.users.filter((user) => {
        const member = user.member;
        const name = fullName(member).toLowerCase();
        const nickname = (member?.nickname || "").toLowerCase();
        const username = (user.username || "").toLowerCase();
        const email = (user.email || "").toLowerCase();

        const matchesSearch =
            !search ||
            name.includes(search) ||
            nickname.includes(search) ||
            username.includes(search) ||
            email.includes(search);

        const matchesRole = !role || user.role === role;
        const matchesStatus = !status || user.account_status === status;

        return matchesSearch && matchesRole && matchesStatus;
    });

    renderUsers();
}

/* =========================================
   RENDER DIRECTORY
   ========================================= */

function renderUsers() {
    const users = state.filteredUsers;
    const body = $("users-body");

    $("result-count").textContent =
        `${users.length} of ${state.users.length} account${state.users.length === 1 ? "" : "s"}`;

    $("users-empty").hidden = users.length !== 0;
    body.closest(".users-table-wrap").hidden = users.length === 0;

    if (users.length === 0) {
        body.innerHTML = "";
        return;
    }

    body.innerHTML = users.map((user) => {
        const member = user.member;
        const name = fullName(member);

        const kapisanan = member?.kapisanan_name ||
            member?.kapisanan_code ||
            "";

        return `
            <tr>
                <td>
                    <div class="user-member-cell">
                        <span class="user-member-name">
                            ${escapeHTML(name)}
                        </span>
                        <span class="user-member-meta">
                            ${escapeHTML(kapisanan || "No Kapisanan assigned")}
                        </span>
                    </div>
                </td>

                <td>
                    <span class="user-username">
                        ${escapeHTML(user.username || "—")}
                    </span>
                </td>

                <td>
                    <span class="user-email">
                        ${escapeHTML(user.email || "—")}
                    </span>
                </td>

                <td>
                    <span class="user-badge ${roleClass(user.role)}">
                        ${escapeHTML(roleLabel(user.role))}
                    </span>
                </td>

                <td>
                    <span class="user-badge ${statusClass(user.account_status)}">
                        ${escapeHTML(statusLabel(user.account_status))}
                    </span>
                </td>

                <td>
                    <span class="user-date">
                        ${escapeHTML(formatDate(user.registered_at || user.created_at))}
                    </span>
                </td>

                <td>
                    <span class="user-date">
                        ${escapeHTML(formatDate(user.last_login_at, true))}
                    </span>
                </td>

                <td class="user-actions">
                    <button
                        type="button"
                        class="user-view-button"
                        data-view-user="${escapeHTML(user.user_id)}">
                        View details
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

/* =========================================
   USER DETAILS MODAL
   ========================================= */

function detailItem(label, value, fullWidth = false) {
    const displayValue = value || "—";

    return `
        <div class="user-detail-item ${fullWidth ? "full-width" : ""}">
            <span class="user-detail-label">${escapeHTML(label)}</span>
            <span class="user-detail-value ${value ? "" : "muted"}">
                ${escapeHTML(displayValue)}
            </span>
        </div>
    `;
}

function openUserModal(userId) {
    const user = state.users.find(
        (item) => item.user_id === userId
    );

    if (!user) return;

    state.selectedUser = user;

    const member = user.member;

    $("user-modal-name").textContent = fullName(member);
    $("user-modal-subtitle").textContent =
        `Account username: ${user.username || "—"}`;

    $("user-modal-details").innerHTML = `
        ${detailItem("Member name", fullName(member), true)}
        ${detailItem("Nickname", member?.nickname)}
        ${detailItem("Kapisanan", member?.kapisanan_name || member?.kapisanan_code)}
        ${detailItem("Username", user.username)}
        ${detailItem("Email address", user.email, true)}

        <div class="user-detail-item">
            <span class="user-detail-label">Role</span>
            <span class="user-detail-value">
                <span class="user-badge ${roleClass(user.role)}">
                    ${escapeHTML(roleLabel(user.role))}
                </span>
            </span>
        </div>

        <div class="user-detail-item">
            <span class="user-detail-label">Account status</span>
            <span class="user-detail-value">
                <span class="user-badge ${statusClass(user.account_status)}">
                    ${escapeHTML(statusLabel(user.account_status))}
                </span>
            </span>
        </div>

        ${detailItem("Registered", formatDate(user.registered_at || user.created_at, true))}
        ${detailItem("Last login", formatDate(user.last_login_at, true))}
        ${detailItem("Account ID", user.user_id, true)}
        ${detailItem("Member ID", user.member_id, true)}
    `;

    $("user-modal").hidden = false;
    document.body.classList.add("modal-open");
}

function closeUserModal() {
    $("user-modal").hidden = true;
    document.body.classList.remove("modal-open");
    state.selectedUser = null;
}

/* =========================================
   INVITE USER
   ========================================= */

function openInviteModal() {
    $("invite-user-form").reset();
    $("invite-error").hidden = true;
    $("invite-error").textContent = "";

    $("invite-user-modal").hidden = false;
    document.body.classList.add("modal-open");

    loadInviteMembers();
}

function closeInviteModal() {
    $("invite-user-modal").hidden = true;
    document.body.classList.remove("modal-open");
}

async function loadInviteMembers() {
    const select = $("invite-member");

    select.disabled = true;
    select.innerHTML = `<option value="">Loading members...</option>`;

    try {
        const { data, error } = await supabase
            .from("member_directory")
            .select(`
                id,
                first_name,
                middle_name,
                last_name,
                suffix,
                nickname,
                kapisanan_code,
                kapisanan_name,
                is_archived,
                is_visitor
            `)
            .eq("is_archived", false)
            .eq("is_visitor", false)
            .order("last_name", { ascending: true });

        if (error) throw error;

        // Exclude members who already have a user profile.
        const existingMemberIds = new Set(
            state.users.map((user) => user.member_id)
        );

        state.inviteMembers = (data || []).filter(
            (member) => !existingMemberIds.has(member.id)
        );

        renderInviteMembers();

    } catch (error) {
        console.error("Unable to load invitation members:", error);

        select.innerHTML =
            `<option value="">Unable to load members</option>`;

        showInviteError(
            error.message || "Unable to load available members."
        );

    } finally {
        select.disabled = false;
    }
}

function renderInviteMembers() {
    const select = $("invite-member");
    const search = $("invite-member-search").value.trim().toLowerCase();

    const members = state.inviteMembers.filter((member) => {
        const name = fullName(member).toLowerCase();
        const nickname = (member.nickname || "").toLowerCase();

        return name.includes(search) || nickname.includes(search);
    });

    select.innerHTML = "";

    if (members.length === 0) {
        select.innerHTML = `
            <option value="">
                No available members found
            </option>
        `;
        return;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a member...";
    select.appendChild(placeholder);

    members.forEach((member) => {
        const option = document.createElement("option");
        option.value = member.id;

        const kapisanan =
            member.kapisanan_name ||
            member.kapisanan_code ||
            "No Kapisanan";

        option.textContent =
            `${fullName(member)} · ${kapisanan}`;

        select.appendChild(option);
    });
}

function showInviteError(message) {
    const element = $("invite-error");
    element.textContent = message;
    element.hidden = false;
}

async function submitInvitation(event) {
    event.preventDefault();

    const submitButton = $("send-invitation");
    const memberId = $("invite-member").value;
    const email = $("invite-email").value.trim();
    const username = $("invite-username").value.trim().toLowerCase();
    const role = $("invite-role").value;

    $("invite-error").hidden = true;
    $("invite-error").textContent = "";

    if (!memberId) {
        showInviteError("Please select an existing member.");
        return;
    }

    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        showInviteError(
            "Username must be 3–30 characters and contain only letters, numbers, dots, underscores, or hyphens."
        );
        return;
    }

    if (!["administrator", "attendance_encoder", "viewer"].includes(role)) {
        showInviteError("Please select a valid role.");
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Sending invitation...";

    try {
        const { data, error } = await supabase.functions.invoke(
            "admin-invite-user",
            {
                body: {
                    member_id: memberId,
                    email,
                    username,
                    role
                }
            }
        );

        if (error) {
            let message = error.message || "Unable to send invitation.";

            // Try to retrieve the Edge Function's actual error message.
            if (error.context && typeof error.context.json === "function") {
                try {
                    const response = await error.context.json();
                    if (response?.error) message = response.error;
                } catch {
                    // Keep the original error message.
                }
            }

            throw new Error(message);
        }

        if (data?.error || !data?.success) {
            throw new Error(data?.error || "Invitation could not be completed.");
        }

        closeInviteModal();

        showToast(
            data.message || "Invitation sent successfully.",
            "success"
        );

        // Refresh the directory so the new pending account appears.
        await loadUsers();

    } catch (error) {
        console.error("Invitation failed:", error);

        showInviteError(
            error.message || "Unable to send invitation. Please try again."
        );

    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Send Invitation";
    }
}

/* =========================================
   MOBILE SIDEBAR
   ========================================= */

function closeMenu() {
    $("sidebar").classList.remove("sidebar-open");
    $("mobile-scrim").hidden = true;
    $("menu-toggle").setAttribute("aria-expanded", "false");
}

function attachMenuEvents() {
    $("menu-toggle").addEventListener("click", () => {
        const open = $("sidebar").classList.toggle("sidebar-open");

        $("mobile-scrim").hidden = !open;
        $("menu-toggle").setAttribute("aria-expanded", String(open));
    });

    $("mobile-scrim").addEventListener("click", closeMenu);
}

/* =========================================
   EVENT LISTENERS
   ========================================= */

function attachEvents() {
    $("refresh-users").addEventListener("click", loadUsers);

    // Invitation modal
    $("add-user-button").addEventListener("click", openInviteModal);

    $("invite-user-form").addEventListener("submit", submitInvitation);

    $("invite-member-search").addEventListener("input", renderInviteMembers);

    document.querySelectorAll('[data-close="invite-user-modal"]').forEach((button) => {
        button.addEventListener("click", closeInviteModal);
    });

    $("invite-user-modal").addEventListener("click", (event) => {
        if (event.target === $("invite-user-modal")) {
            closeInviteModal();
        }
    });

    $("user-search").addEventListener("input", applyFilters);
    $("filter-role").addEventListener("change", applyFilters);
    $("filter-status").addEventListener("change", applyFilters);

    $("reset-filters").addEventListener("click", () => {
        $("user-search").value = "";
        $("filter-role").value = "";
        $("filter-status").value = "";

        applyFilters();
    });

    $("users-body").addEventListener("click", (event) => {
        const button = event.target.closest("[data-view-user]");
        if (!button) return;

        openUserModal(button.dataset.viewUser);
    });

    document.querySelectorAll('[data-close="user-modal"]').forEach((button) => {
        button.addEventListener("click", closeUserModal);
    });

    $("user-modal").addEventListener("click", (event) => {
        if (event.target === $("user-modal")) {
            closeUserModal();
        }
    });

    document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

        if (!$("invite-user-modal").hidden) {
            closeInviteModal();
        } else if (!$("user-modal").hidden) {
            closeUserModal();
        }
    });

    $("logout-button").addEventListener("click", async () => {
        const button = $("logout-button");
        button.disabled = true;

        const { error } = await supabase.auth.signOut();

        if (error) {
            button.disabled = false;
            showToast(error.message || "Unable to sign out.", "error");
            return;
        }

        window.location.replace(LOGIN_PAGE);
    });

    document.querySelectorAll(".coming-soon").forEach((button) => {
        button.addEventListener("click", () => {
            showToast(`${button.dataset.module || "This module"} is coming soon.`);
        });
    });

    attachMenuEvents();
}

/* =========================================
   AUTH STATE CHANGES
   ========================================= */

function watchAuthState() {
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session) {
            window.location.replace(LOGIN_PAGE);
        }
    });
}

/* =========================================
   INITIALIZE
   ========================================= */

async function initialize() {
    try {
        attachEvents();

        const authorized = await initializeAuth();

        if (!authorized) return;

        watchAuthState();

        await loadUsers();

    } catch (error) {
        console.error("User Management initialization failed:", error);

        $("app-loading").hidden = true;
        showPageError(
            error.message || "Unable to initialize User Management."
        );
    }
}

initialize();
