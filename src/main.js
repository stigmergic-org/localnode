import { app } from 'electron';
import { loadConfig, getCertsDir } from './utils/config.js';
import { startServer } from './main/server.js';
import { setupTray } from './main/tray.js';
import { createSettingsWindow } from './main/windows.js';
import { setupIPCHandlers } from './main/ipc-handlers.js';
import { checkAndInstallCertificates } from './main/cert-manager.js';
import { createLogger } from './utils/logger.js';

let tray = null;
let server = null;
const logger = createLogger('Main');

/**
 * Initialize and start the server
 */
async function initServer(options = {}) {
  try {
    logger.info('Starting LocalNode server');
    server = await startServer(options);
    logger.info('LocalNode server started successfully');
  } catch (error) {
    logger.error('Failed to start server', error);
  }
}

// Main app initialization
app.whenReady().then(async () => {
  // Load configuration first
  const config = loadConfig();
  logger.info('Loaded configuration', config);
  
  // Setup IPC handlers
  setupIPCHandlers(server);
  
  // Check and install certificates BEFORE creating tray
  await checkAndInstallCertificates();
  
  // Hide dock icon after certificate dialog is done (macOS accessory app)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  
  // Create tray icon
  tray = setupTray(() => createSettingsWindow());
  
  logger.info('LocalNode tray app ready');
  
  // Start server
  await initServer({
    port: config.port,
    consensusRpc: config.consensusRpc,
    executionRpc: config.executionRpc,
    domain: config.domain,
    certDir: getCertsDir()
  });
});

// Prevent app from quitting when all windows are closed (tray app behavior)
app.on('window-all-closed', (e) => {
  if (e) e.preventDefault();
});

// Don't quit on macOS when windows close
app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
});

// Clean up on quit
app.on('before-quit', () => {
  logger.info('Shutting down LocalNode');
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
  }
});

