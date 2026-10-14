// -----------------------------------------------------------------------------
// Entry point of the Tailscale integration for Gladys Assistant.
//
// SDK wiring only: every handler lives in src/app.js, which takes the client as
// a parameter so the tests can hand it the SDK's fake Gladys instead.
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK, `new GladysIntegration()` is enough):
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createTailscaleApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createTailscaleApp(gladys);

// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

logger.info('Starting the Tailscale integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
