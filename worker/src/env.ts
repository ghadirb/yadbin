export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  PLAY_BASE_URL?: string;
  /** Public origin of the API (payment callback). Optional: defaults to PLAY_BASE_URL. */
  API_BASE_URL?: string;
  /** Subscription limits (all optional; code defaults in subscription/config.ts). Values are non-negative integers as strings. */
  TRIAL_DAYS?: string;
  FREE_MAX_CLASSES?: string;
  FREE_MAX_STUDENTS?: string;
  FREE_MAX_ASSESSMENTS?: string;
  FREE_AI_REQUESTS?: string;
  /** Payment provider id. Unset / 'none' = online payment not available yet. No real gateway is wired in this version. */
  PAYMENT_PROVIDER?: string;
  /** Myket in-app purchase (PAYMENT_PROVIDER='myket'). Public RSA key from the Myket developer panel (base64 SPKI) — public, may be a var. */
  MYKET_PUBLIC_KEY?: string;
  /** Android package name registered in Myket (default com.yadbin.teacher). */
  MYKET_PACKAGE_NAME?: string;
  /** X-Access-Token from the Myket panel («محصولات درون‌برنامه‌ای»). A Worker SECRET — server-to-server only, never in the app. */
  MYKET_ACCESS_TOKEN?: string;
  /** 'true' enables the Mock provider, and ONLY when ENVIRONMENT is not 'production'. */
  PAYMENT_MOCK_ENABLED?: string;
  /** Optional Cloudflare Workers AI binding. Without it the AI Activity Builder uses its rule-based engine only. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AI_MODEL?: string;
  /** Optional AvalAI (OpenAI-compatible) key — a Worker SECRET, never committed. When set it is the first AI provider. */
  AVALAI_API_KEY?: string;
  /** AvalAI model id (pin it for stable behaviour). Default in code: gpt-5.4-mini. */
  AVALAI_MODEL?: string;
  /** Vision model that reads PDF page IMAGES (scanned / broken-font books). Default in code: gemini-flash-latest. */
  AVALAI_VISION_MODEL?: string;
  /** Override the AvalAI base URL (default https://api.avalai.ir/v1). */
  AVALAI_BASE_URL?: string;
}
