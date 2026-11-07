import { supabase } from "./supabase-client.js";

const $ = (id) => document.getElementById(id);

function showError(message) {
    $("checking-state").hidden = true;
    $("accept-form").hidden = true;
    $("success-state").hidden = true;
    $("error-state").hidden = false;

    $("error-message").textContent = message;
    $("page-title").textContent = "Invitation verification failed";
    $("page-description").textContent =
        "We could not complete your account registration.";
}

function showForm() {
    $("checking-state").hidden = true;
    $("accept-form").hidden = false;

    $("page-title").textContent = "Set your password";
    $("page-description").textContent =
        "Create a secure password to activate your account.";
}

function showSuccess() {
    $("checking-state").hidden = true;
    $("accept-form").hidden = true;
    $("error-state").hidden = true;
    $("success-state").hidden = false;

    $("page-title").textContent = "Welcome!";
    $("page-description").textContent =
        "Your invitation has been accepted.";
}

async function initialize() {
    try {
        /*
         * Supabase JS detects and processes the invitation
         * session from the URL when the client is initialized.
         */
        const {
            data: { session },
            error
        } = await supabase.auth.getSession();

        if (error) throw error;

        if (!session?.user) {
            showError(
                "No valid invitation session was found. Please open the latest invitation email link. If it has expired, ask an administrator to send a new invitation."
            );
            return;
        }

        const {
            data: { user },
            error: userError
        } = await supabase.auth.getUser();

        if (userError || !user) {
            showError(
                "We could not verify your account. Please open your invitation email again."
            );
            return;
        }

        if (!user.email_confirmed_at) {
            showError(
                "Your email address has not been verified. Please use the invitation link sent to your email."
            );
            return;
        }

        // Allow an already activated account to continue.
        const { data: profile, error: profileError } = await supabase
            .from("user_profiles")
            .select("account_status")
            .eq("user_id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (profile?.account_status === "active") {
            showSuccess();
            return;
        }

        if (!profile || profile.account_status !== "pending") {
            showError(
                "This account is not eligible for activation. Please contact an administrator."
            );
            return;
        }

        showForm();

    } catch (error) {
        console.error("Invitation initialization failed:", error);

        showError(
            error.message || "Unable to verify your invitation."
        );
    }
}

async function handleSubmit(event) {
    event.preventDefault();

    const password = $("password").value;
    const confirmPassword = $("confirm-password").value;
    const button = $("activate-button");
    const errorElement = $("form-error");

    errorElement.hidden = true;
    errorElement.textContent = "";

    if (password.length < 8) {
        errorElement.textContent =
            "Your password must contain at least 8 characters.";
        errorElement.hidden = false;
        return;
    }

    if (password !== confirmPassword) {
        errorElement.textContent = "Your passwords do not match.";
        errorElement.hidden = false;
        return;
    }

    button.disabled = true;
    button.textContent = "Activating account...";

    try {
        // Save the password for the authenticated invited user.
        const { error: passwordError } = await supabase.auth.updateUser({
            password
        });

        if (passwordError) throw passwordError;

        // Activate the pending profile and accept the invitation.
        const { data, error } = await supabase.functions.invoke(
            "admin-activate-invitation",
            { body: {} }
        );

        if (error) {
            let message = error.message || "Unable to activate your account.";

            if (error.context && typeof error.context.json === "function") {
                try {
                    const response = await error.context.json();
                    if (response?.error) message = response.error;
                } catch {
                    // Keep the original error.
                }
            }

            throw new Error(message);
        }

        if (data?.error || !data?.success) {
            throw new Error(
                data?.error || "Unable to activate your account."
            );
        }

        showSuccess();

    } catch (error) {
        console.error("Account activation failed:", error);

        errorElement.textContent =
            error.message || "Unable to activate your account. Please try again.";

        errorElement.hidden = false;

    } finally {
        button.disabled = false;
        button.textContent = "Set Password & Activate Account";
    }
}

$("accept-form").addEventListener("submit", handleSubmit);

initialize();