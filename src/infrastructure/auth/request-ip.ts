import { isIP } from "node:net";

export function getClientIp(
  forwardedFor: string | null,
  connectionIp?: string,
): string {
  const candidate =
    forwardedFor === null
      ? connectionIp
      : forwardedFor.split(",").at(-1)?.trim();
  if (!candidate || !isIP(candidate)) return "unknown";
  if (isIP(candidate) === 4) return candidate;
  try {
    const canonical = new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
    const [left = "", right] = canonical.split("::");
    const start = left ? left.split(":") : [];
    const end = right ? right.split(":") : [];
    const blocks = (
      right === undefined
        ? start
        : [
            ...start,
            ...Array<string>(8 - start.length - end.length).fill("0"),
            ...end,
          ]
    ).map((part) => Number.parseInt(part, 16));
    if (
      blocks.slice(0, 5).every((part) => part === 0) &&
      blocks[5] === 0xffff
    ) {
      return [blocks[6] ?? 0, blocks[7] ?? 0]
        .flatMap((part) => [part >> 8, part & 255])
        .join(".");
    }
    return `${blocks
      .slice(0, 4)
      .map((part) => part.toString(16))
      .join(":")}::/64`;
  } catch {
    return "unknown";
  }
}
