import { Application } from './main/application.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('Main');

// Create and start the application
const application = new Application();

application.start().catch(error => {
  logger.error('Failed to start application', error);
  process.exit(1);
});

