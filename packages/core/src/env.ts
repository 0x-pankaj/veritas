import { z } from "zod";

/**
 * Typed env loader (BUILD_PLAN P0-T3). Each app validates only the vars it
 * needs: `loadEnv(envSchema.pick({...}))`. Throws a clear, aggregated error
 * listing every missing/invalid var.
 */
export const envSchema = z.object({
  SOLANA_RPC: z.string().url(),
  SOLANA_KEYPAIR: z.string().min(1, "JSON byte-array keypair required"),
  VERITAS_PROGRAM_ID: z.string().min(32),
  ARC_RPC: z.string().url(),
  ARC_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "0x-prefixed 32-byte hex"),
  GATEWAY_API_URL: z.string().url(),
  MOCK_SETTLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  COORDINATOR_PORT: z.coerce.number().int().positive().default(3001),
  COORDINATOR_API_KEY: z.string().min(16, "min 16 chars"),
  VERITAS_FACILITATOR_URL: z.string().url(),
  VERITAS_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(200),
  /** Gateway address Veritas fee auths pay to. */
  VERITAS_FEE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default("0x000000000000000000000000000000000000dEaD"),
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${details}\nSee .env.example.`);
  }
  return result.data;
}
