import { BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set app icon path
const appIconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');

let settingsWindow = null;
let certDialogWindow = null;

/**
 * Create settings window
 */
export function createSettingsWindow() {
  // Don't create multiple windows
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Settings',
    icon: appIconPath,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'settings', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));

  // Clean up when closed
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // Remove menu bar for cleaner look
  settingsWindow.setMenuBarVisibility(false);
}

/**
 * Create certificate installation dialog
 * @returns {Promise} Resolves with user's choice
 */
export function createCertDialog() {
  return new Promise((resolve) => {
    certDialogWindow = new BrowserWindow({
      width: 540,
      height: 580,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Certificate Installation',
      icon: appIconPath,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'cert-install', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    certDialogWindow.loadFile(path.join(__dirname, '..', 'renderer', 'cert-install', 'index.html'));
    certDialogWindow.setMenuBarVisibility(false);

    certDialogWindow.on('closed', () => {
      // If window was closed without a response, treat as skipped
      if (certDialogWindow && certDialogWindow.resolveFunction) {
        certDialogWindow.resolveFunction({ skipped: true });
      }
      certDialogWindow = null;
    });

    // Store the resolve function so IPC handler can call it
    certDialogWindow.resolveFunction = resolve;
  });
}

/**
 * Close settings window
 */
export function closeSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.close();
  }
}

/**
 * Close certificate dialog window
 */
export function closeCertDialogWindow() {
  if (certDialogWindow) {
    certDialogWindow.close();
  }
}

/**
 * Get certificate dialog window
 */
export function getCertDialogWindow() {
  return certDialogWindow;
}

