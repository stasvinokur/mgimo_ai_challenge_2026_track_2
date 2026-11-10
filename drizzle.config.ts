import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./src/infrastructure/db/client";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/db/schema/**/*.ts",
  out: "./drizzle",
  dbCredentials: process.env.DATABASE_URL
    ? { url: getDatabaseUrl() }
    : undefined,
});
