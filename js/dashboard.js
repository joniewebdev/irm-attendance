import {
    supabase
} from "./supabase-client.js";
import {
    requireActiveSession,
    watchAuthState
} from "./auth-guard.js";
import {
    showToast
} from "./utilities.js";
watchAuthState();
const result = await requireActiveSession();
if (result) {
    document.getElementById("profile-name").textContent = result.profile.username;
    document.getElementById("profile-role").textContent = result.profile.role.replaceAll("_", " ")
}
document.getElementById("logout-button").onclick = async () => {
    const b = document.getElementById("logout-button");
    b.disabled = true;
    const {
        error
    } = await supabase.auth.signOut();
    if (error) {
        showToast(error.message, "error");
        b.disabled = false;
        return
    }
    location.replace("./login.html")
};