import { formatCertificateDate } from "@/application/certificates/format-date";
import type { CertificateVerificationDto } from "@/application/certificates/verify-certificate";
import { appPath } from "@/ui/shared/app-path.mjs";
import { verificationStyles } from "./verification-styles";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

// A complete static document lets the route return HTTP 404/429 before streaming.
export function VerificationDocument({
  certificate,
  status,
  tokens,
  notice,
  retryUrl,
}: {
  certificate?: CertificateVerificationDto;
  status: number;
  tokens: string;
  notice: string;
  retryUrl: string;
}): string {
  const title = certificate
    ? "Проверка справки"
    : status === 404
      ? "Справка не найдена"
      : status === 429
        ? "Слишком много проверок"
        : "Не удалось проверить справку";
  const heading = certificate
    ? certificate.status === "valid"
      ? "Справка действительна"
      : "Отозвана"
    : "Что можно сделать";
  const details = certificate
    ? `
    <dl class="verification-fields">
      <div><dt>Студент</dt><dd>${escapeHtml(certificate.fullName)}</dd></div>
      <div><dt>Тип справки</dt><dd>${escapeHtml(certificate.type)}</dd></div>
      <div><dt>Номер</dt><dd>${escapeHtml(certificate.number)}</dd></div>
      <div><dt>Дата выдачи (МСК)</dt><dd><time datetime="${escapeHtml(certificate.issuedAt)}">${formatCertificateDate(certificate.issuedAt)}</time></dd></div>
    </dl>
    <p class="verification-hint">${certificate.status === "valid" ? "Сведения совпадают с записью в конкурсном концепте «Пульс»." : "Эта справка отозвана. Попросите студента предоставить новую."}</p>`
    : `
    <p>${status === 404 ? "Проверьте ссылку или повторно отсканируйте QR-код из справки." : status === 429 ? "Подождите 10 минут и повторите проверку." : "Попробуйте снова через несколько минут."}</p>
    ${status === 404 ? "" : `<a class="verification-retry" href="${escapeHtml(retryUrl)}">Повторить проверку</a>`}`;
  const badge = certificate
    ? `<span data-slot="badge" class="status-${certificate.status === "valid" ? "success" : "danger"}"><span aria-hidden="true">${certificate.status === "valid" ? "✓" : "!"}</span>${certificate.status === "valid" ? "Действительна" : "Отозвана"}</span>`
    : "";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${title} · Пульс</title>
  <link rel="icon" href="${appPath("/favicon.svg")}">
  <style>${tokens + verificationStyles}</style>
</head>
<body>
  <header class="verification-header">
    <a href="${appPath("/")}" class="verification-brand"><img src="${appPath("/pulse.svg")}" width="40" height="40" alt=""><span>Пульс<span class="verification-caption">цифровой деканат</span></span></a>
  </header>
  <main id="main-content" class="verification-main">
    <p class="verification-eyebrow">Проверка по QR-коду</p>
    <h1>${title}</h1>
    <section data-slot="card" aria-labelledby="certificate-status">
      <div data-slot="card-header"><h2 id="certificate-status">${heading}</h2>${badge}</div>
      <div data-slot="card-content">${details}</div>
    </section>
    <p class="verification-notice">Вымышленная справка конкурсного концепта MGIMO×AI Challenge. Не является официальным документом.</p>
  </main>
  <footer class="concept-notice"><span class="concept-mark" aria-hidden="true">П</span><p>${escapeHtml(notice)}</p></footer>
</body>
</html>`;
}
