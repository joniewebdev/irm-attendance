import {
    supabase
} from "./supabase-client.js";
import {
    FUNCTIONS_BASE_URL,
    SUPABASE_ANON_KEY,
    isConfigured
} from "./supabase-config.js";
import {
    showToast,
    friendlyError
} from "./utilities.js";
const form = document.getElementById("login-form"),
    err = document.getElementById("login-error"),
    pass = document.getElementById("password"),
    btn = document.getElementById("login-submit");
document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("toggle-password").onclick = e => {
    pass.type = pass.type === "password" ? "text" : "password";
    e.currentTarget.textContent = pass.type === "password" ? "Show" : "Hide"
};
(async () => {
    if (!isConfigured) {
        err.textContent = "Configure js/supabase-config.js first.";
        err.hidden = false;
        return
    }
    const {
        data: {
            session
        }
    } = await supabase.auth.getSession();
    if (session) location.replace("./dashboard.html")
})();
form.addEventListener("submit", async e => {
    e.preventDefault();
    err.hidden = true;
    const username = document.getElementById("username").value.trim().toLowerCase(),
        password = pass.value;
    if (!username || !password) {
        err.textContent = "Enter both username and password.";
        err.hidden = false;
        return
    }
    if (!isConfigured) {
        err.textContent = "Configure Supabase first.";
        err.hidden = false;
        return
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
        const r = await fetch(`${FUNCTIONS_BASE_URL}/username-login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "apikey": SUPABASE_ANON_KEY
                },
                body: JSON.stringify({
                    username,
                    password
                })
            }),
            p = await r.json();
        if (!r.ok) throw Error(p.error || "Unable to sign in.");
        const {
            error
        } = await supabase.auth.setSession(p.session);
        if (error) throw error;
        location.replace("./dashboard.html")
    } catch (e) {
        err.textContent = friendlyError(e);
        err.hidden = false
    } finally {
        btn.disabled = false;
        btn.textContent = "Sign in"
    }
});
document.getElementById("forgot-button").onclick = async () => {
    const username = document.getElementById("username").value.trim().toLowerCase();
    if (!username) {
        showToast("Enter your username first.", "error");
        return
    }
    try {
        const r = await fetch(`${FUNCTIONS_BASE_URL}/username-password-reset`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                username
            })
        });
        if (!r.ok) throw Error();
        showToast("If eligible, a password reset email will be sent.")
    } catch {
        showToast("Password reset request failed.", "error")
    }
};