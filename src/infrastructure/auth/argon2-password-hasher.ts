import { hash, verify } from "@node-rs/argon2";
import type { PasswordHasher } from "@/application/ports/password-hasher";

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, {
      // Argon2id; the library's ambient const enum cannot be used with isolatedModules.
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  }

  async verify(encoded: string, password: string): Promise<boolean> {
    if (!encoded.startsWith("$argon2id$")) return false;
    try {
      return await verify(encoded, password);
    } catch {
      return false;
    }
  }
}
