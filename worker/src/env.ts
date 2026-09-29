export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  PLAY_BASE_URL?: string;
}
