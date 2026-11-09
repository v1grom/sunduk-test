// Анонимная статистика посещений (самохостинг Umami, https://stats.sunduk.one).
// Свой лёгкий клиент вместо стандартного script.js: работает из PWA без сети (запрос просто
// теряется), не требует cookies и умеет отправлять события из C#.
// Отправляется: адрес страницы, размер экрана, язык, случайный идентификатор устройства.
// Никакие введённые значения, станки и инструменты не отправляются.
window.sundukAnalytics = (() => {
    const endpoint = 'https://stats.sunduk.one/api/send';
    // Идентификаторы сайтов в Umami. На прочих адресах (localhost, GitHub Pages) статистика выключена.
    const websites = {
        'www.sunduk.one': '31d1cb95-87fc-4a2f-802e-53a42c98854e',
        'sunduk.one': '31d1cb95-87fc-4a2f-802e-53a42c98854e',
        'test.sunduk.one': '81795dd6-5e52-4870-8e79-ed8239268f9c',
    };
    const enabledKey = 'app-analytics-enabled';
    const idKey = 'analytics-id';

    function enabled() {
        try { return localStorage.getItem(enabledKey) !== 'false'; } catch { return true; }
    }

    function deviceId() {
        try {
            let id = localStorage.getItem(idKey);
            if (!id) {
                id = crypto.randomUUID();
                localStorage.setItem(idKey, id);
            }
            return id;
        } catch { return undefined; }
    }

    let lastUrl = location.pathname;

    function send(extra) {
        const website = websites[location.hostname];
        if (!website || !enabled() || navigator.webdriver) return;
        const payload = Object.assign({
            website,
            hostname: location.hostname,
            screen: `${screen.width}x${screen.height}`,
            language: navigator.language,
            title: document.title,
            url: location.pathname + location.search,
            referrer: '',
            id: deviceId(),
        }, extra);
        try {
            fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'event', payload }),
                keepalive: true,
                credentials: 'omit',
            }).catch(() => { });
        } catch { /* статистика не должна мешать работе */ }
    }

    return {
        // Просмотр страницы. path — относительный путь без начального слеша.
        pageview(path) {
            const url = '/' + path.split('?')[0].replace(/^\//, '');
            const prev = lastUrl;
            lastUrl = url;
            send({ url, referrer: prev === url ? '' : prev });
        },
        // Именованное событие (например, «cam-generate»).
        track(name, data) {
            send(data ? { name, data } : { name });
        },
    };
})();
