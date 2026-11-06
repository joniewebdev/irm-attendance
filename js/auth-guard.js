import {
    supabase
} from "./supabase-client.js";
export async function requireActiveSession() {
    const {
        data: {
            session
        },
        error
    } = await supabase.auth.getSession();
    if (error || !session) {
        location.replace("./login.html");
        return null
    }
    const {
        data: profile,
        error: pe
    } = await supabase.from("user_profiles").select("user_id,member_id,username,role,account_status").eq("user_id", session.user.id).maybeSingle();
    if (pe || !profile || profile.account_status !== "active") {
        await supabase.auth.signOut();
        location.replace("./login.html");
        return null
    }
    document.getElementById("app-loading").hidden = true;
    document.getElementById("app-content").hidden = false;
    return {
        session,
        profile
    }
}
export function watchAuthState() {
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session) location.replace("./login.html")
    })
}