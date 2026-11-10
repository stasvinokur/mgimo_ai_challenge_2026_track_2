import { ForbiddenError } from "../shared/errors";

export function attendanceOrigin(
  headers: { get(name: string): string | null },
  configured?: string,
): string {
  if (configured) return new URL(configured).origin;
  const host =
    headers.get("x-forwarded-host")?.split(",").at(-1)?.trim() ||
    headers.get("host");
  if (!host || !/^(?:\[[a-f\d:.]+\]|[a-z\d.-]+)(?::\d+)?$/i.test(host))
    throw new ForbiddenError();
  const forwarded = headers.get("x-forwarded-proto")?.split(",").at(-1)?.trim();
  if (forwarded && forwarded !== "https" && forwarded !== "http")
    throw new ForbiddenError();
  return new URL(`${forwarded || "http"}://${host}`).origin;
}
