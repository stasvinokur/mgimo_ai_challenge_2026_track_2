import "server-only";

import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, type Language, parseLanguage } from "./language";

export async function getLanguage(): Promise<Language> {
  return parseLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
}
