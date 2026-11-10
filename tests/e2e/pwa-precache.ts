import {
  type ArrayExpression,
  type KeyValueProperty,
  parseSync,
} from "@swc/core";

// Parse the built worker without executing service worker code in the test process.
export function precacheURLs(source: string): string[] {
  const program = parseSync(source, { syntax: "ecmascript" });
  const arrays = new Map<string, ArrayExpression>();
  for (const statement of program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      if (
        declaration.id.type === "Identifier" &&
        declaration.init?.type === "ArrayExpression"
      )
        arrays.set(declaration.id.value, declaration.init);
    }
  }
  const manifests: string[][] = [];
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if ("type" in node && node.type === "KeyValueProperty") {
      const property = node as KeyValueProperty;
      const key = property.key;
      if (
        (key.type === "Identifier" || key.type === "StringLiteral") &&
        key.value === "precacheEntries"
      ) {
        // esbuild may hoist the literal into a top-level variable.
        const array =
          property.value.type === "ArrayExpression"
            ? property.value
            : property.value.type === "Identifier"
              ? arrays.get(property.value.value)
              : undefined;
        if (!array)
          throw new Error(
            "Не удалось прочитать массив precache из production SW.",
          );
        const urls = array.elements.map((entry) => {
          const expression = entry?.expression;
          if (expression?.type === "StringLiteral") return expression.value;
          if (expression?.type === "ObjectExpression") {
            for (const item of expression.properties) {
              if (item.type !== "KeyValueProperty") continue;
              const key = item.key;
              if (
                (key.type === "Identifier" || key.type === "StringLiteral") &&
                key.value === "url" &&
                item.value.type === "StringLiteral"
              )
                return item.value.value;
            }
          }
          throw new Error(
            "Не удалось прочитать URL precache из production SW.",
          );
        });
        manifests.push(urls);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  }
  visit(program);
  const urls = manifests[0];
  if (
    manifests.length !== 1 ||
    !urls?.length ||
    urls.some((url) => !url.startsWith("/") || url.startsWith("//"))
  )
    throw new Error(
      "В production SW не найден однозначный локальный precache.",
    );
  return urls;
}
