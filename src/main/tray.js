import { Menu, Tray, shell, nativeImage, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

// Get dependency versions from our package.json
const heliosVersion = packageJson.dependencies['@a16z/helios']?.replace('^', '') || 'unknown';
const kuboVersion = packageJson.dependencies['kubo']?.replace('^', '') || 'unknown';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create tray icon image
 * @returns {NativeImage} Tray icon
 */
function createTrayIcon() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'logo.png');
  
  let icon = nativeImage.createFromPath(iconPath);
  
  if (icon.isEmpty()) {
    console.error('ERROR: logo.png could not be loaded from:', iconPath);
    throw new Error('Tray icon file not found or invalid');
  }
  
  // Resize to appropriate tray size for macOS
  icon = icon.resize({ width: 22, height: 22 });
  
  // Mark as template image so macOS automatically adjusts color based on menu bar theme
  icon.setTemplateImage(true);
  
  return icon;
}

/**
 * Setup tray icon and menu
 * @param {Function} onSettingsClick - Callback for settings click
 * @returns {Tray} Tray instance
 */
export function setupTray(onSettingsClick) {
  const trayIcon = createTrayIcon();
  const tray = new Tray(trayIcon);
  
  // Set tooltip
  tray.setToolTip('LocalNode - ENS Resolver');
  
  // Create the context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Local Node',
      enabled: false
    },
    {
      label: 'Dashboard',
      click: () => {
        shell.openExternal('https://node.localhost');
      }
    },
    {
      label: 'Explore Dapps',
      click: () => {
        shell.openExternal('https://dapprank.eth.localhost');
      }
    },
    {
      label: 'Explore IPFS',
      click: () => {
        shell.openExternal('http://localhost:5001/webui');
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Settings',
      click: onSettingsClick
    },
    {
      label: 'About',
      submenu: [
        {
          label: `LocalNode v${packageJson.version}`,
          click: () => {
            shell.openExternal('https://localnode.eth.localhost');
          }
        },
        {
          type: 'separator'
        },
        {
          label: `Helios v${heliosVersion}`,
          click: () => {
            shell.openExternal('https://github.com/a16z/helios');
          }
        },
        {
          label: `IPFS (Kubo) v${kuboVersion}`,
          click: () => {
            shell.openExternal('https://github.com/ipfs/kubo');
          }
        },
        {
          type: 'separator'
        },
        {
          label: 'Submit Feedback',
          click: () => {
            shell.openExternal('https://github.com/stigmergic-org/localnode');
          }
        }
      ]
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Handle click to show menu
  tray.on('click', () => {
    tray.popUpContextMenu(contextMenu);
  });
  
  return tray;
}

