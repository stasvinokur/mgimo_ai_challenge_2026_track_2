import { validateBasePath } from "@/application/shared/app-path.mjs";

export function getBasePath() {
  return validateBasePath(process.env.BASE_PATH);
}
