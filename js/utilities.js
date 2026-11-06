export function showToast(message, type = "info") {
    const r = document.getElementById("toast-region");
    if (!r) return;
    const e = document.createElement("div");
    e.className = "toast";
    e.textContent = message;
    if (type === "error") e.style.background = "#8e2929";
    r.append(e);
    setTimeout(() => e.remove(), 4000)
}
export function friendlyError(e) {
    const m = String(e?.message || "Something went wrong.");
    if (/invalid login credentials/i.test(m)) return "Incorrect username or password.";
    if (/network|fetch/i.test(m)) return "Unable to connect. Check your internet connection.";
    return m
}