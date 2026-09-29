-- Fixed-window rate limiting counters (see src/utils/ratelimit.ts).
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
