import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const url = new URL(process.env.DATABASE_URL!);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
  },
});
