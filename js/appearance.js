// Скин, тема и плотность для стилей вне MudBlazor (css/tokens.css читает атрибуты <html>).
// Блок в <head> страницы применяет сохранённые значения до отрисовки, чтобы не мигала чужая тема.
window.sundukAppearance = {
    apply(skin, dark) {
        const root = document.documentElement;
        root.dataset.skin = skin;
        root.dataset.theme = dark ? 'dark' : 'light';
        root.classList.toggle('mud-dark', !!dark);
        root.classList.toggle('mud-light', !dark);
        document.body.classList.toggle('mud-dark', !!dark);
        document.body.classList.toggle('mud-light', !dark);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || meta.content;
    }
};
