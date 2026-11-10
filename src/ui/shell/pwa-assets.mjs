import { appPath } from "../shared/app-path.mjs";

export function pwaManifest() {
  const manifest = {
    id: "/",
    name: "Пульс — цифровой деканат",
    short_name: "Пульс",
    description: "Конкурсный концепт цифрового деканата. Все данные вымышлены.",
    lang: "ru",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    theme_color: "#f5f6f2",
    background_color: "#f5f6f2",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
  return {
    ...manifest,
    id: appPath(manifest.id),
    start_url: appPath(manifest.start_url),
    scope: appPath(manifest.scope),
    icons: manifest.icons.map((icon) => ({ ...icon, src: appPath(icon.src) })),
  };
}

export function offlineDocument() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f5f6f2">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'">
<title>Нет сети · Пульс</title>
<link rel="icon" href="${appPath("/favicon.svg")}">
<link rel="stylesheet" href="${appPath("/offline.css")}">
<script src="${appPath("/offline.js")}" defer></script>
</head>
<body>
<main>
<img src="${appPath("/pulse.svg")}" width="64" height="64" alt="Пульс">
<h1>Пока нет сети</h1>
<p>Эта страница ещё не сохранена. Подключитесь к интернету и попробуйте снова.</p>
<button type="button" id="retry">Повторить</button>
<nav aria-label="Сохранённые страницы"><a href="${appPath("/today")}">Сегодня</a><a href="${appPath("/schedule")}">Расписание</a></nav>
</main>
<footer>Конкурсный концепт MGIMO×AI Challenge. Не официальный сервис МГИМО. Все данные вымышлены</footer>
</body>
</html>
`;
}
