import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/backends/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
