
const CACHE_NAME = "irm-attendance-v1";

const APP_SHELL = [
    "./",
    "./index.html",
    "./dashboard.html",
    "./manifest.json"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll(APP_SHELL)
        )
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        )
    );

    self.clients.claim();
});

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Do not cache Supabase requests or external resources.
    if (url.origin !== self.location.origin) return;

    // HTML navigation: network first, then cached fallback.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache =>
                            cache.put(request, copy)
                        );
                    }
                    return response;
                })
                .catch(async () => {
                    return await caches.match(request) ||
                           await caches.match("./index.html");
                })
        );
        return;
    }

    // Static resources: cache first.
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            return fetch(request).then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache =>
                        cache.put(request, copy)
                    );
                }
                return response;
            });
        })
    );
});
