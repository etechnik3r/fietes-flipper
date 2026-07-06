/* ===========================================================================
   Fietes Formenflipper – Service Worker (sw.js)
   ---------------------------------------------------------------------------
   Macht das Spiel offline-faehig (PWA): alle Dateien werden beim Installieren
   in den Cache gelegt und danach cache-first ausgeliefert.

   WICHTIG: Bei jeder Aenderung an den Spieldateien die VERSION hochzaehlen
   (gleich mit der ?v=NUMMER in index.html) – sonst liefert der Cache alt aus.
   ===========================================================================*/

var VERSION = "v3";
var CACHE_NAME = "fietes-formenflipper-" + VERSION;

var DATEIEN = [
  "./",
  "index.html",
  "style.css?v=3",
  "game.js?v=3",
  "matter.min.js",
  "manifest.webmanifest",
  "icon.svg",
  "fonts/baloo2-latin.woff2",
  "fonts/nunito-latin.woff2"
];

self.addEventListener("install", function (ereignis) {
  ereignis.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(DATEIEN); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (ereignis) {
  ereignis.waitUntil(
    caches.keys().then(function (namen) {
      return Promise.all(namen.map(function (name) {
        if (name !== CACHE_NAME) { return caches.delete(name); }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (ereignis) {
  if (ereignis.request.method !== "GET") { return; }
  ereignis.respondWith(
    caches.match(ereignis.request, { ignoreSearch: false }).then(function (treffer) {
      if (treffer) { return treffer; }
      return fetch(ereignis.request).catch(function () {
        // Offline-Fallback fuer Seitenaufrufe: die Startseite.
        if (ereignis.request.mode === "navigate") { return caches.match("index.html"); }
      });
    })
  );
});
