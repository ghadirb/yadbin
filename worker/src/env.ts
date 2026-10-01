export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  PLAY_BASE_URL?: string;
  /** Optional Cloudflare Workers AI binding. Without it the AI Activity Builder uses its rule-based engine only. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AI_MODEL?: string;
  /** Optional AvalAI (OpenAI-compatible) key — a Worker SECRET, never committed. When set it is the first AI provider. */
  AVALAI_API_KEY?: string;
  /** AvalAI model id (pin it for stable behaviour). Default in code: gpt-5.4-mini. */
  AVALAI_MODEL?: string;
  /** Override the AvalAI base URL (default https://api.avalai.ir/v1). */
  AVALAI_BASE_URL?: string;
}
