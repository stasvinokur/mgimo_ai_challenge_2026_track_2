/** @param {string | undefined} value */
export function validateBasePath(value) {
  const path = value ?? "";
  if (path !== "" && (path.trim() !== path || !/^\/[a-z0-9-]+$/.test(path)))
    throw new Error(
      "BASE_PATH: укажите пустое значение или один сегмент /dekanat (a–z, 0–9, дефис), без завершающего слэша.",
    );
  return path;
}

/** @param {string} path @param {string} [base] */
export function appPath(path, base = "") {
  return `${validateBasePath(base)}${path}`;
}

/** @param {string} path @param {string} [base] */
export function withoutBasePath(path, base = "") {
  validateBasePath(base);
  if (!base) return path;
  if (path === base) return "/";
  return path.startsWith(`${base}/`) ? path.slice(base.length) : null;
}

/** @param {string} origin @param {string} path @param {string} [base] */
export function absoluteAppUrl(origin, path, base = "") {
  return new URL(appPath(path, base), new URL(origin).origin).href;
}

/** @param {string} name @param {string} [base] */
export function appStorageName(name, base = "") {
  return `${name}${validateBasePath(base).replace("/", "-")}`;
}
