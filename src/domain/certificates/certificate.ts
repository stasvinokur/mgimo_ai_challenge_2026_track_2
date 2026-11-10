export function certificateDestination(
  typeCode: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  const value = payload[typeCode === "military" ? "office" : "destination"];
  return typeof value === "string" && value.trim()
    ? value
    : "По месту требования";
}

export function maskFullName(fullName: string): string {
  // Student profiles store given names first and the family name last.
  const parts = fullName.trim().split(/\s+/u);
  const surname = parts.pop() ?? "";
  const names = parts;
  return [surname, ...names.map((name) => `${Array.from(name)[0]}.`)]
    .join(" ")
    .trim();
}

export function isCertificateNumber(value: string): boolean {
  return /^С-\d{4}-\d{6,}$/.test(value);
}

export function isVerificationCode(value: string): boolean {
  // Sixteen bytes in unpadded RFC 4648 base32 have two padding bits.
  return /^[A-Z2-7]{25}[AEIMQUY4]$/.test(value);
}
