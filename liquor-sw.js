/* ==========================================================================
   MADOLLAR LIQUOR PUB - offline page cache (service worker)
   Registered by main.js with scope "./liquor.html", so it only ever controls
   the liquor system page and never the other websites in this repository.

   - The page and main.js: network first (always the newest version when online),
     the saved copy only when the network fails.
   - Libraries, fonts and images: saved after the first visit, refreshed in the background.
   - Firebase data and alert services are never touched here (Firestore keeps
     its own offline copy of the data).
   ========================================================================== */

const CACHE = "madollar-shell-v1";
const SHELL = ["./liquor.html", "./img/logo.jpeg", "./img/liquor-192.png"];

const NEVER_CACHE_HOSTS = [
    "firestore.googleapis.com",
    "world.openfoodfacts.org",
    "firebaseinstallations.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "firebase.googleapis.com",
    "www.googleapis.com",
    "api.telegram.org",
    "api.callmebot.com",
    "api.web3forms.com"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;

    const sameOrigin = url.origin === self.location.origin;
    const isAppCode = sameOrigin && (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/main.js"));

    if (isAppCode) {
        // Network first: never serve an old page or script while online
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./liquor.html")))
        );
        return;
    }

    // Everything else: use the saved copy straight away, refresh it in the background
    event.respondWith(
        caches.match(req).then((cached) => {
            const refresh = fetch(req)
                .then((res) => {
                    if (res && (res.ok || res.type === "opaque")) {
                        const copy = res.clone();
                        caches.open(CACHE).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || refresh;
        })
    );
});
