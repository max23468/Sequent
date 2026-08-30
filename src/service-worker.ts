/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";
import { documentContentHeaders } from "$lib/document-content-headers";
import { OFFLINE_DATABASE_NAME } from "$lib/offline/types";

const worker = self as unknown as ServiceWorkerGlobalScope;
const STATIC_CACHE = `sequent-static-${version}`;
const PRACTICE_CACHE = "sequent-practices-v1";
const staticAssets = [...build, ...files];

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(staticAssets)));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const practiceCache = await caches.open(PRACTICE_CACHE);
      for (const key of await caches.keys()) {
        if (key.startsWith("sequent-practices-stage-")) {
          await caches.delete(key);
          continue;
        }
        if (!key.startsWith("sequent-practices-") || key === PRACTICE_CACHE) continue;
        const legacyCache = await caches.open(key);
        for (const request of await legacyCache.keys()) {
          const response = await legacyCache.match(request);
          if (response) await practiceCache.put(request, response);
        }
        await caches.delete(key);
      }
      await worker.clients.claim();
    })(),
  );
});

function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function offlineDocument(
  resourcePath: string,
  legacyDocumentId?: string,
): Promise<Response | null> {
  const database = await openOfflineDatabase();
  return new Promise((resolve) => {
    const transaction = database.transaction("documents", "readonly");
    const store = transaction.objectStore("documents");
    const request = store.indexNames.contains("by-resource")
      ? store.index("by-resource").get(resourcePath)
      : store.index("by-document").get(legacyDocumentId ?? "");
    request.onsuccess = () => {
      database.close();
      const document = request.result as
        | {
            bytes?: ArrayBuffer;
            blob?: Blob;
            mediaType: string;
            name: string;
            byteSize: number;
          }
        | undefined;
      const body = document?.bytes ?? document?.blob;
      resolve(
        document && body
          ? new Response(body, {
              headers: documentContentHeaders({
                mediaType: document.mediaType,
                byteSize: document.byteSize,
                fileName: document.name,
                fallbackName: "documento",
              }),
            })
          : null,
      );
    };
    request.onerror = () => {
      database.close();
      resolve(null);
    };
  });
}

async function cachedPracticeNavigation(request: Request): Promise<Response | undefined> {
  const exact = await caches.match(request, { ignoreVary: true });
  if (exact) return exact;
  const requested = new URL(request.url);
  const cache = await caches.open(PRACTICE_CACHE);
  const matching = (await cache.keys()).find((candidate) => {
    const cached = new URL(candidate.url);
    if (cached.pathname !== requested.pathname) return false;
    const parameter = (url: URL, name: string) => {
      if (name === "vista")
        return (
          url.searchParams.get(name) ??
          (url.searchParams.get("sezione") === "quadri" ? "quadri" : "operational")
        );
      return url.searchParams.get(name) ?? "";
    };
    return ["vista", "sezione", "quadro"].every(
      (name) => parameter(cached, name) === parameter(requested, name),
    );
  });
  return matching ? cache.match(matching) : undefined;
}

async function networkOrOfflineDocument(
  request: Request,
  resourcePath: string,
  documentId?: string,
) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch {
    // La copia IndexedDB è l'autorità locale quando il server non risponde.
  }
  return (
    (await offlineDocument(resourcePath, documentId)) ??
    new Response("Documento non disponibile offline", { status: 404 })
  );
}

async function networkOrCachedNavigation(request: Request) {
  try {
    const response = await fetch(request);
    if (response.ok || response.status < 500) return response;
  } catch {
    // La cache selettiva viene consultata anche per errori di rete espliciti.
  }
  return (
    (await cachedPracticeNavigation(request)) ??
    new Response("Questa pagina non è disponibile offline.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  );
}

worker.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== worker.location.origin) return;
  const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/content$/);
  const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/content$/);
  if (documentMatch || attachmentMatch) {
    event.respondWith(
      networkOrOfflineDocument(
        event.request,
        url.pathname,
        documentMatch ? decodeURIComponent(documentMatch[1]!) : undefined,
      ),
    );
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(networkOrCachedNavigation(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((response) => response ?? fetch(event.request)),
  );
});

worker.addEventListener("message", (event) => {
  const message = event.data as
    | { type: "CACHE_PRACTICE"; practiceId: string; urls: string[] }
    | { type: "REMOVE_PRACTICE"; practiceId: string }
    | { type: "CLEAR_OFFLINE" };
  if (message.type === "CACHE_PRACTICE") {
    event.waitUntil(
      (async () => {
        const stagingName = `sequent-practices-stage-${message.practiceId}-${Date.now()}`;
        try {
          const staging = await caches.open(stagingName);
          for (const url of message.urls) {
            const response = await fetch(url, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`OFFLINE_ROUTE_${response.status}`);
            await staging.put(url, response);
          }
          const cache = await caches.open(PRACTICE_CACHE);
          for (const request of await cache.keys()) {
            if (new URL(request.url).pathname === `/pratiche/${message.practiceId}`)
              await cache.delete(request);
          }
          for (const request of await staging.keys()) {
            const response = await staging.match(request);
            if (response) await cache.put(request, response);
          }
          await caches.delete(stagingName);
          event.ports[0]?.postMessage({ ok: true });
        } catch (error) {
          await caches.delete(stagingName);
          event.ports[0]?.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : "OFFLINE_CACHE_FAILED",
          });
        }
      })(),
    );
  } else if (message.type === "REMOVE_PRACTICE") {
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open(PRACTICE_CACHE);
          for (const request of await cache.keys()) {
            if (new URL(request.url).pathname === `/pratiche/${message.practiceId}`)
              await cache.delete(request);
          }
          event.ports[0]?.postMessage({ ok: true });
        } catch (error) {
          event.ports[0]?.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : "OFFLINE_REMOVE_FAILED",
          });
        }
      })(),
    );
  } else if (message.type === "CLEAR_OFFLINE") {
    event.waitUntil(
      (async () => {
        try {
          await Promise.all(
            (await caches.keys())
              .filter(
                (key) =>
                  key === PRACTICE_CACHE ||
                  key.startsWith("sequent-practices-stage-") ||
                  (key.startsWith("sequent-static-") && key !== STATIC_CACHE),
              )
              .map((key) => caches.delete(key)),
          );
          event.ports[0]?.postMessage({ ok: true });
        } catch (error) {
          event.ports[0]?.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : "OFFLINE_CLEAR_FAILED",
          });
        }
      })(),
    );
  }
});
