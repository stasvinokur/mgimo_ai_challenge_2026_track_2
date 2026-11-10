const certificateDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

export function formatCertificateDate(value: string): string {
  return certificateDate.format(new Date(value));
}
