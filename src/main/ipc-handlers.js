import { ipcMain } from 'electron';
import { loadConfig, saveConfig, getCertsDir } from '../utils/config.js';
import { LocalCA } from '../certificates/local-ca.js';
import { closeSettingsWindow, getCertDialogWindow } from './windows.js';

/**
 * Setup all IPC handlers
 * @param {Object} server - The LocalNodeServer instance
 */
export function setupIPCHandlers(server) {
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
      
      console.log('Configuration saved successfully');
      
      // Restart server with new configuration
      if (server) {
        console.log('Applying new settings...');
        await server.restart({
          consensusRpc: config.consensusRpc,
          executionRpc: config.executionRpc,
          ipfsApiUrl: config.ipfsApiUrl
        });
        console.log('Settings applied successfully');
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error applying settings:', error);
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
      const localCA = new LocalCA(certDir);
      const success = await localCA.installCAToSystem();
      return { success };
    } catch (error) {
      console.error('Error installing certificate:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('cert-dialog-response', (event, result) => {
    const certDialogWindow = getCertDialogWindow();
    if (certDialogWindow && certDialogWindow.resolveFunction) {
      certDialogWindow.resolveFunction(result);
      // Close the window after resolving
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

