export const staffCommentOptions = {
  needs_info: [
    {
      code: "organization",
      label: "Уточните полное название организации — места требования.",
    },
    {
      code: "purpose",
      label: "Уточните цель обращения, чтобы мы подготовили нужный документ.",
    },
    {
      code: "details",
      label: "Проверьте сведения в заявке и сообщите, что нужно исправить.",
    },
    {
      code: "delivery",
      label: "Уточните удобный способ получения документа.",
    },
  ],
  rejected: [
    {
      code: "different_type",
      label:
        "Для этой цели нужен другой тип заявки. Выберите его в каталоге и подайте новое обращение.",
    },
    {
      code: "unsupported_document",
      label:
        "Такой документ не оформляется по выбранному типу заявки. Уточните цель в деканате.",
    },
    {
      code: "duplicate",
      label:
        "В заявке обнаружено повторное обращение. Следите за статусом ранее поданной заявки.",
    },
  ],
} as const;

export function staffCommentLabel(to: string, code: string): string | null {
  if (to !== "needs_info" && to !== "rejected") return null;
  return (
    staffCommentOptions[to].find((option) => option.code === code)?.label ??
    null
  );
}
