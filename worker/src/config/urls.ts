import type { Env } from '../env';

const trim = (s: string | undefined) => (s || '').replace(/\/+$/, '');

/** Public origin used to build student links (/play/{token}, /preview/{token}). Today: workers.dev. Later: https://yadbinapp.ir */
export const playBaseUrl = (env: Env): string => trim(env.PLAY_BASE_URL);

/** Public origin of the API (payment callback URL). Defaults to PLAY_BASE_URL because one Worker serves both. */
export const apiBaseUrl = (env: Env): string => trim(env.API_BASE_URL) || playBaseUrl(env);
