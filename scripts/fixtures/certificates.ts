import { randomBytes } from "node:crypto";
import type { certificates } from "../../src/infrastructure/db/schema/certificates";
import type { FixtureContext } from "./shared";

function verificationCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of randomBytes(16)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function certificateFixtures(
  ctx: FixtureContext,
  issuedAt: Date,
): (typeof certificates.$inferInsert)[] {
  return [
    {
      ...ctx.row("certificate:anna"),
      requestId: ctx.row("request:0").id,
      number: "С-2026-000001",
      verifyCode: verificationCode(),
      issuedAt,
    },
  ];
}
