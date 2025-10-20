import { app } from 'electron';
import { loadConfig, getCertsDir } from '../utils/config.js';
import { startServer } from './server.js';
import { setupTray } from './tray.js';
import { createSettingsWindow } from './windows.js';
import { setupIPCHandlers } from './ipc-handlers.js';
import { checkAndInstallCertificates } from './cert-manager.js';
import { createLogger } from '../utils/logger.js';

/**
 * Application - Manages the entire Electron app lifecycle
 * Coordinates tray, server, windows, and IPC handlers
 */
export class Application {
  constructor() {
    this.logger = createLogger('Application');
    this.tray = null;
    this.server = null;
    this.config = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      // Load configuration
      this.config = loadConfig();
      this.logger.info('Configuration loaded', this.config);

      // Check and install certificates before creating UI
      await checkAndInstallCertificates();

      // Hide dock icon on macOS (accessory app)
      this.hideDockIcon();

      // Setup IPC handlers (now server will be available via getter)
      setupIPCHandlers(this);

      // Create tray icon
      this.tray = setupTray(() => createSettingsWindow());
      this.logger.info('Tray initialized');

      // Start server
      await this.startServer();

      this.logger.info('Application initialization complete');
    } catch (error) {
      this.logger.error('Failed to initialize application', error);
      throw error;
    }
  }

  /**
   * Start the server with current configuration
   */
  async startServer() {
    try {
      this.logger.info('Starting server');
      this.server = await startServer({
        port: this.config.port,
        consensusRpc: this.config.consensusRpc,
        executionRpc: this.config.executionRpc,
        domain: this.config.domain,
        certDir: getCertsDir(),
        autoSeedingIntervalMinutes: this.config.autoSeedingIntervalMinutes
      });
      this.logger.info('Server started successfully');
    } catch (error) {
      this.logger.error('Failed to start server', error);
      throw error;
    }
  }

  /**
   * Get the server instance (for IPC handlers)
   */
  getServer() {
    return this.server;
  }

  /**
   * Hide dock icon on macOS
   */
  hideDockIcon() {
    if (process.platform === 'darwin') {
      app.dock.hide();
      this.logger.debug('Dock icon hidden (macOS)');
    }
  }

  /**
   * Setup app event handlers
   */
  setupEventHandlers() {
    // Prevent app from quitting when all windows are closed (tray app behavior)
    app.on('window-all-closed', (e) => {
      if (e) e.preventDefault();
    });

    // macOS activate event (usually no-op for tray apps)
    app.on('activate', () => {
      // Intentionally empty - tray apps don't recreate windows on activate
    });

    // Handle Ctrl+C and other termination signals
    // In Electron apps, these should trigger app.quit() for proper cleanup
    const handleShutdownSignal = (signal) => {
      this.logger.info(`${signal} received - initiating graceful shutdown`);
      if (!app.isQuitting) {
        app.quit();
      }
    };

    process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
    process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));

    // Cleanup before quit - stop server first
    app.on('before-quit', async (event) => {
      if (this.server && !this.isShuttingDown) {
        this.logger.info('Stopping server');
        this.isShuttingDown = true;
        
        // Prevent default quit to allow async cleanup
        event.preventDefault();
        
        try {
          await this.server.stop();
          this.logger.info('Server stopped successfully');
        } catch (error) {
          this.logger.error('Error stopping server', error);
        }
        
        // Now quit for real
        app.quit();
      }
    });

    // Final cleanup on quit
    app.on('will-quit', () => {
      this.cleanup();
    });
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      this.logger.debug('Tray destroyed');
    }
  }

  /**
   * Start the application
   */
  async start() {
    this.setupEventHandlers();
    await app.whenReady();
    await this.initialize();
  }
}

