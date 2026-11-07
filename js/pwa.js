
if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            const registration =
                await navigator.serviceWorker.register(
                    "./service-worker.js"
                );

            console.log(
                "PWA Service Worker registered:",
                registration.scope
            );
        } catch (error) {
            console.error(
                "PWA registration failed:",
                error
            );
        }
    });
}
