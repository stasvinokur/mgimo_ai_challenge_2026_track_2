import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ArrowFunctionExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  parseSync,
} from "@swc/core";
import { expect, it } from "vitest";

for (const [group, guard] of [
  ["student", "requireStudent"],
  ["staff", "requireStaff"],
  ["teacher", "requireTeacher"],
  ["attend", "requireStudent"],
] as const) {
  const root = resolve(
    group === "attend" ? "src/app/attend" : `src/app/(${group})`,
  );
  const entries = readdirSync(root, {
    recursive: true,
    encoding: "utf8",
  }).filter((file) => /(?:^|\/)(page|actions|route)\.tsx?$/.test(file));
  for (const entry of entries) {
    it(`${group}/${entry}: каждый обработчик ожидает ${guard} до чтения данных`, () => {
      const ast = parseSync(readFileSync(resolve(root, entry), "utf8"), {
        syntax: "typescript",
        tsx: entry.endsWith(".tsx"),
      });
      const imported = ast.body.flatMap((node) =>
        node.type === "ImportDeclaration" &&
        node.source.value === "@/app/_lib/get-actor"
          ? node.specifiers
              .filter(
                (specifier) =>
                  specifier.type === "ImportSpecifier" &&
                  (specifier.imported?.value ?? specifier.local.value) ===
                    guard,
              )
              .map((specifier) => specifier.local.value)
          : [],
      );
      expect(imported).toContain(guard);
      const handlers = ast.body.flatMap<
        FunctionDeclaration | FunctionExpression | ArrowFunctionExpression
      >((node) => {
        if (
          node.type === "ExportDefaultDeclaration" &&
          node.decl.type === "FunctionExpression"
        )
          return [node.decl];
        if (node.type !== "ExportDeclaration") return [];
        if (node.declaration.type === "FunctionDeclaration")
          return [node.declaration];
        if (node.declaration.type !== "VariableDeclaration") return [];
        return node.declaration.declarations.flatMap(({ init }) =>
          init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression"
            ? [init]
            : [],
        );
      });
      expect(
        handlers.length,
        "Обработчики должны явно вызывать guard, без реэкспорта.",
      ).toBeGreaterThan(0);
      for (const handler of handlers) {
        if (!handler.body || !("stmts" in handler.body))
          throw new Error("Обработчик должен содержать блок с guard.");
        const first = handler.body.stmts[0];
        const expression =
          first?.type === "ExpressionStatement"
            ? first.expression
            : first?.type === "VariableDeclaration"
              ? first.declarations[0]?.init
              : undefined;
        expect(expression?.type).toBe("AwaitExpression");
        if (
          expression?.type !== "AwaitExpression" ||
          expression.argument.type !== "CallExpression" ||
          expression.argument.callee.type !== "Identifier"
        )
          throw new Error("Первое действие обработчика должно ожидать guard.");
        expect(expression.argument.callee.value).toBe(guard);
      }
    });
  }
}
