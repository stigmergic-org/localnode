import { ipcMain } from 'electron';
import { loadConfig, saveConfig, getCertsDir } from '../utils/config.js';
import { OpenSSLCA } from '../certificates/openssl-ca.js';
import { closeSettingsWindow, getCertDialogWindow } from './windows.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('IPC');

/**
 * Setup all IPC handlers
 * @param {Application} application - The Application instance
 */
export function setupIPCHandlers(application) {
  // Configuration handlers
  ipcMain.handle('load-config', () => {
    return loadConfig();
  });

  ipcMain.handle('save-config', async (event, config) => {
    try {
      const success = saveConfig(config);
      if (!success) {
        return { success: false, error: 'Failed to save configuration' };
      }
      
      logger.info('Configuration saved successfully');
      
      // Restart server with new configuration
      const server = application.getServer();
      if (server) {
        logger.info('Applying new settings...');
        await server.restart({
          consensusRpc: config.consensusRpc,
          executionRpc: config.executionRpc,
          ipfsApiUrl: config.ipfsApiUrl
        });
        logger.info('Settings applied successfully');
      }
      
      return { success: true };
    } catch (error) {
      logger.error('Error applying settings', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('close-settings', () => {
    closeSettingsWindow();
  });

  // Certificate installation handlers
  ipcMain.handle('install-certificate', async () => {
    try {
      const certDir = getCertsDir();
      const opensslCA = new OpenSSLCA(certDir);
      const success = await opensslCA.installCAToSystem();
      return { success };
    } catch (error) {
      logger.error('Error installing certificate', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('cert-dialog-response', (event, result) => {
    const certDialogWindow = getCertDialogWindow();
    if (certDialogWindow && certDialogWindow.resolveFunction) {
      certDialogWindow.resolveFunction(result);
      certDialogWindow.close();
    }
  });

  ipcMain.on('resize-cert-dialog', (event, { width, height }) => {
    const certDialogWindow = getCertDialogWindow();
    if (certDialogWindow) {
      certDialogWindow.setSize(width, height);
      certDialogWindow.center();
    }
  });
}

