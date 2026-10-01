export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  PLAY_BASE_URL?: string;
  /** Optional Cloudflare Workers AI binding. Without it the AI Activity Builder uses its rule-based engine only. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AI_MODEL?: string;
}
