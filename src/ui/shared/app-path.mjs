import * as paths from "../../application/shared/app-path.mjs";

// Next and the worker replace the public build setting with the same literal.
export function basePath() {
  return paths.validateBasePath(process.env.BASE_PATH);
}

/** @param {string} path */
export function appPath(path) {
  return paths.appPath(path, basePath());
}

/** @param {string} path */
export function withoutBasePath(path) {
  return paths.withoutBasePath(path, basePath());
}

/** @param {string} origin @param {string} path */
export function absoluteAppUrl(origin, path) {
  return paths.absoluteAppUrl(origin, path, basePath());
}

/** @param {string} name */
export function appStorageName(name) {
  return paths.appStorageName(name, basePath());
}
