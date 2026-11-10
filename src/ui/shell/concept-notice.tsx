export function ConceptNotice({ children }: { children: string }) {
  return (
    <footer className="concept-notice">
      <span className="concept-mark" aria-hidden="true">
        П
      </span>
      <p>{children}</p>
    </footer>
  );
}
export const conceptNoticeText =
  "Конкурсный концепт MGIMO×AI Challenge. Не официальный сервис МГИМО. Все данные вымышлены";
