export function asksForOtherStudent(question: string): boolean {
  // This is a UX shortcut; tools enforce access through Actor.
  return /(?<!\p{L})(?:student[_\s]?id|user[_\s]?id|чуж(?:ие|их|ой)|друг(?:ого|ой) студент(?:а|у|ом|е|к(?:а|и|е|у|ой|ою))?|одногруппник(?:а|у|ом|е|и|ов|ам|ами|ах)?|Тимур(?:а|у|ом|е)?|(?:Белов|Соколов)(?:а|у|ым|е|ой|ы|ою)?|Анн(?:а|ы|у|е|ой|ою))(?!\p{L})/iu.test(
    question,
  );
}

// Preserve the student's spelling; schema validation alone cannot establish provenance.
export function groundedFields(
  fields: Record<string, unknown>,
  words: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        entry[1].length > 0 &&
        words.includes(entry[1]),
    ),
  );
}
