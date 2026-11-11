/* Manifest version: SGeT6Vn8 */
// Caution! Be sure you understand the caveats before publishing an application with
// offline support. See https://aka.ms/blazor-offline-considerations

self.importScripts('./service-worker-assets.js');
self.addEventListener('install', event => event.waitUntil(onInstall(event)));
self.addEventListener('activate', event => event.waitUntil(onActivate(event)));
self.addEventListener('fetch', event => event.respondWith(onFetch(event)));

const cacheNamePrefix = 'offline-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;

// Маркер, который onActivate кладёт в кэш, когда офлайн-версия полностью загружена.
// По нему страница определяет, можно ли уже отключать интернет.
const readyMarkerUrl = '/__sunduk_offline_ready__';

const offlineAssetsInclude = [ /\.dll$/, /\.pdb$/, /\.wasm/, /\.html/, /\.js$/, /\.json$/, /\.css$/, /\.woff$/, /\.woff2$/, /\.svg$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.blat$/, /\.dat$/ ];

// Обязательно включаем манифест приложения: без него установленный PWA без сети
// не сможет прочитать start_url/иконки.
offlineAssetsInclude.push(/\.webmanifest$/);

// Мусор, который в офлайн-кэше только жрёт место и время загрузки:
// исходники less/scss, метаданные, sourcemaps, неиспользуемые форматы шрифтов
// (приложение грузит self-hosted fonts/*.woff2), не-minified дубликаты
// FontAwesome-стилей и скриптов и сырые svg-иконки FontAwesome (иконки рисуются
// шрифтом из css/all.min.css, отдельные файлы в wwwroot/svgs не нужны — 1690 файлов).
const offlineAssetsExclude = [
    /^service-worker\.js$/,
    /\.(less|scss|yml|map)$/,
    /^metadata\//,
    /^webfonts\/.*\.(eot|ttf|woff|svg)$/,
    /^css\/(all|brands|fontawesome|regular|solid|svg-with-js|v4-shims)\.css$/,
    /^js\/(all|brands|conflict-detection|fontawesome|regular|solid|v4-shims)\.js$/,
    /^svgs\//,
];

// Сколько файлов качать одновременно. Последовательная загрузка 2000+ файлов
// занимает минуты на мобильном интернете, и install frequently не успевает
// завершиться — тогда офлайн-кэша не появляется вообще.
const installBatchSize = 16;

// Файлы с отпечатком в имени (name.abc123defg.ext) неизменны — им годится HTTP-кэш.
// Остальные (_framework/dotnet.js со списком сборок приложения, js/*.js, manifest)
// nginx отдаёт с max-age на неделю: без ревалидации телефон неделю грузит старый
// dotnet.js, а по нему — старые сборки, при том что index.html и SW уже новые.
const fingerprinted = /\.[a-z0-9]{10}\.[a-z0-9]+$/;
function cacheModeFor(url) {
    const path = new URL(url, self.location.href).pathname;
    return fingerprinted.test(path) ? 'default' : 'no-cache';
}

// Сколько ждём сеть при навигации, прежде чем отдать index.html из кэша.
const navigationTimeoutMs = 3000;

async function onInstall(event) {
    console.info('Service worker: Install');

    // Применяем новую версию сразу, а не после нескольких перезагрузок.
    self.skipWaiting();

    // Fetch and cache all matching items from the assets manifest
    const allRequests = self.assetsManifest.assets
        .filter(asset => offlineAssetsInclude.some(pattern => pattern.test(asset.url)))
        .filter(asset => !offlineAssetsExclude.some(pattern => pattern.test(asset.url)))
        .map(asset => new Request(asset.url, { integrity: asset.hash, cache: cacheModeFor(asset.url) }));

    const total = allRequests.length;
    const cache = await caches.open(cacheName);

    // Кэш этой версии переживает прерванную установку (мобильный браузер убивает
    // воркер в фоне, а скачивание идёт минуты). Уже лежащие в нём файлы не качаем
    // заново — иначе каждая попытка начиналась бы с нуля и могла не завершиться никогда.
    const alreadyCached = new Set((await cache.keys()).map(r => r.url));
    const assetsRequests = allRequests.filter(r => !alreadyCached.has(r.url));
    const failed = [];
    let done = total - assetsRequests.length;
    if (done > 0) console.info(`Service worker: в кэше уже ${done} из ${total}, докачиваю остальное`);

    for (let i = 0; i < assetsRequests.length; i += installBatchSize) {
        const batch = assetsRequests.slice(i, i + installBatchSize);
        const results = await Promise.allSettled(batch.map(req => cache.add(req)));
        for (let j = 0; j < results.length; j++) {
            done++;
            if (results[j].status === 'rejected') failed.push(batch[j].url);
        }
        await notifyClients({ type: 'offline-progress', cached: done - failed.length, total, failed: failed.length });
    }

    if (failed.length) {
        // Раньше эти ошибки молча терялись в console.warn, и пропущенные ассеты
        // было невозможно заметить — именно так и не заметили сломанные ?v= ссылки.
        console.error(`Service worker: не удалось закэшировать ${failed.length} из ${total} ассетов:`, failed);
        await notifyClients({ type: 'offline-progress', cached: total - failed.length, total, failed: failed.length, failedUrls: failed });
    } else {
        console.info(`Service worker: офлайн-кэш собран, ${total} файлов`);
    }
}

async function onActivate(event) {
    console.info('Service worker: Activate');

    // Delete unused caches
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys
        .filter(key => key.startsWith(cacheNamePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));

    // Сразу забираем управление, чтобы свежая версия работала с первой загрузки.
    await self.clients.claim();

    // Маркер готовности: пока его нет, офлайн-версия считается недокачанной.
    const cache = await caches.open(cacheName);
    const marker = new Response(
        JSON.stringify({ version: self.assetsManifest.version, installedAt: Date.now() }),
        { headers: { 'Content-Type': 'application/json' } });
    await cache.put(new Request(readyMarkerUrl), marker);

    // Сообщаем открытым страницам версию: если она отличается от той, с которой
    // страница загрузилась, значит обновление установлено и пора перезагрузиться.
    await notifyClients({ type: 'offline-activated', version: self.assetsManifest.version });
}

async function onFetch(event) {
    if (event.request.method !== 'GET') return fetch(event.request);

    const isNavigation = event.request.mode === 'navigate';

    // Навигация — network-first. Иначе после деплою пользователь продолжает видеть
    // старую версию из кэша старого service worker, пока тот не обновится
    // (установка идёт в фоне и занимает минуты). Запросов навигации ровно один
    // и файл маленький, поэтому свежесть важнее миллисекунд.
    // Без сети отдаём index.html из кэша.
    if (isNavigation) {
        try {
            return await fetchWithTimeout(event.request, navigationTimeoutMs);
        } catch (e) {
            console.info('Service worker: навигация из сети недоступна, беру index.html из кэша:', e);
        }
        const cache = await caches.open(cacheName);
        return (await cache.match('index.html', { ignoreSearch: true })) ?? offlineResponse();
    }

    // Ассеты — сначала штатный путь браузера: fetch() уходит в HTTP-кэш (все
    // имена файлов захэшированы, Cache-Control — неделя), поэтому сеть не
    // задействована, зато работают WebAssembly.compileStreaming и кэш
    // скомпилированного кода. Замер до остальных правок (218 ассемблей):
    // cache-first стоил ~5 лишних секунд на каждой загрузке — caches.open()
    // + cache.match() с ignoreSearch по кэшу из ~2000 записей на каждый
    // из 242 запросов (1.0 с со включённым перехватом против 6.0 с без него).
    let networkResponse = null;
    try {
        networkResponse = await fetch(event.request, { cache: cacheModeFor(event.request.url) });
    } catch (e) {
        console.info('Service worker: сеть недоступна, беру ассет из офлайн-кэша:', event.request.url, e);
    }

    // Ошибочный ответ сети (404 и т.п.) не глотаем: если в кэше тоже нет —
    // возвращаем именно его, чтобы поломка была видна.
    if (networkResponse && (networkResponse.ok || networkResponse.status === 304)) return networkResponse;

    const cache = await caches.open(cacheName);

    // ignoreSearch обязателен: index.html может запрашивать ассеты с ?v=N, а в
    // манифесте лежат URL без query. Без ignoreSearch Cache Storage считает их
    // разными ключами, и ассет молча не находится в офлайне.
    const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
    if (cachedResponse) return cachedResponse;

    // Раньше здесь промис просто реджектился, и один непрокэшированный ассет
    // ронял загрузку. Отдаём пустой ответ, чтобы страница доехала.
    if (networkResponse) return networkResponse;

    console.warn('Service worker: ассет недоступен офлайн:', event.request.url);
    return offlineResponse();
}

async function fetchWithTimeout(request, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // cache: 'no-cache' — всегда ревалидировать index.html на сервере (304, если не
        // менялся). Иначе nginx без Cache-Control даёт браузеру право по эвристике
        // (10% от возраста Last-Modified) часами отдавать старый index.html из
        // HTTP-кэша, и телефон остаётся на старой сборке при свежем SW-кэше.
        return await fetch(request, { signal: controller.signal, cache: 'no-cache' });
    } finally {
        clearTimeout(timer);
    }
}

function offlineResponse() {
    return new Response('', { status: 504, statusText: 'Offline' });
}

async function notifyClients(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) client.postMessage(message);
}
