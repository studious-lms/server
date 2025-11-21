import * as Sentry from "@sentry/node";
import { env } from "./lib/config/env.js";

// Only initialize Sentry in non-test environments
if (env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV || 'development',
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
    // @todo: disable in test environment
    enabled: true, // Explicitly disable in test environment
  });
}
