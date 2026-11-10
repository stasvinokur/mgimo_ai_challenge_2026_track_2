const zod = [
  "^zod(?:/|$)",
  "^node_modules/zod/",
  "^node_modules/\\.pnpm/zod@[^/]+/node_modules/zod/",
];

module.exports = {
  forbidden: [
    {
      name: "src-no-scripts-or-tests",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^(?:scripts|tests)/" },
    },
    {
      name: "no-unresolved-imports",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular-imports",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { pathNot: "^src/domain/" },
    },
    {
      name: "application-dependencies",
      severity: "error",
      from: { path: "^src/application/", pathNot: "/schemas\\.ts$" },
      to: { pathNot: ["^src/domain/", "^src/application/"] },
    },
    {
      name: "application-schemas-dependencies",
      severity: "error",
      from: {
        path: [
          "^src/application/schemas\\.ts$",
          "^src/application/.+/schemas\\.ts$",
        ],
      },
      to: { pathNot: ["^src/domain/", "^src/application/", ...zod] },
    },
    {
      name: "infrastructure-dependencies",
      severity: "error",
      from: { path: "^src/infrastructure/" },
      to: { path: "^src/(?:app|ui|composition)/" },
    },
    {
      name: "presentation-dependencies",
      severity: "error",
      from: { path: "^src/(?:app|ui)/" },
      to: { path: "^src/(?:infrastructure|domain)/" },
    },
    {
      name: "presentation-no-auth-or-push-libraries",
      severity: "error",
      from: { path: "^src/(?:app|ui)/" },
      to: {
        path: "(?:^|/)(?:@simplewebauthn/server|web-push)(?:/|$)",
      },
    },
    {
      // The WebAuthn browser client belongs to the identity UI only (D-40).
      name: "webauthn-browser-only-in-identity-ui",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/ui/identity/" },
      to: { path: "(?:^|/)@simplewebauthn/browser(?:/|$)" },
    },
    {
      name: "ui-no-composition",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/composition/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    parser: "swc",
    // SWC reads type-only imports directly; tsPreCompilationDeps requires the TSC API.
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
