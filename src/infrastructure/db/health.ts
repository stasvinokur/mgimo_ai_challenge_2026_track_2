import { getDatabase } from "./client";

export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    await getDatabase()`select 1`;
    return true;
  } catch {
    return false;
  }
}
