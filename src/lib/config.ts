import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const EnvSchema = z.object({
  SIMULATOR_BASE_URL: z.url().default('http://localhost:8000'),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  SIMULATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  SIMULATOR_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  LOOP_POLL_MS: z.coerce.number().int().min(250).default(500),
  DEMAND_HISTORY_TICKS: z.coerce.number().int().min(4).max(160).default(32),
  AUTOPILOT_MODE: z.enum(['MANUAL', 'ASSISTED', 'AUTO']).default('ASSISTED'),
  ENABLE_SCENARIO_CONTROLS: z.stringbool().default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_MODEL: z.preprocess(emptyToUndefined, z.string().default('gpt-4.1-mini')),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
});

export type AppConfig = z.infer<typeof EnvSchema>;

function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const config = loadConfig();
