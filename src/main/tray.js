import { Menu, Tray, shell, nativeImage, app } from 'electron';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

// Get dependency versions from our package.json
const heliosVersion = packageJson.dependencies['@a16z/helios']?.replace('^', '') || 'unknown';
const kuboVersion = packageJson.dependencies['kubo']?.replace('^', '') || 'unknown';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('Tray');

/**
 * Create tray icon image
 * @returns {NativeImage} Tray icon
 */
function createTrayIcon() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'logo.png');
  
  let icon = nativeImage.createFromPath(iconPath);
  
  if (icon.isEmpty()) {
    logger.error('Icon could not be loaded', { iconPath });
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
 * @param {HeliosClient} heliosClient - Helios client instance
 * @param {Function} onSettingsClick - Callback for settings click
 * @returns {Tray} Tray instance
 */
export function setupTray(heliosClient, onSettingsClick) {
  const trayIcon = createTrayIcon();
  const tray = new Tray(trayIcon);
  
  // Set tooltip
  tray.setToolTip('LocalNode - ENS Resolver');
  
  let updateInterval = null;
  
  /**
   * Build the context menu with current gas prices
   * @param {Object|null} gasPrices - Gas prices object or null
   */
  const buildContextMenu = (gasPrices = null) => {
    const gasMenuItem = gasPrices
      ? {
          label: `⛽ ${gasPrices.low} | ${gasPrices.mid} | ${gasPrices.high} gwei`,
          enabled: false
        }
      : {
          label: '⛽ Loading...',
          enabled: false
        };
    
    return Menu.buildFromTemplate([
      {
        label: 'Local Node',
        enabled: false
      },
      {
        type: 'separator'
      },
      gasMenuItem,
      {
        type: 'separator'
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
      // gasMenuItem,
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
  };
  
  /**
   * Update gas prices in the menu
   */
  const updateGasPrices = async () => {
    try {
      const gasPrices = await heliosClient.getGasPrices();
      if (gasPrices) {
        const contextMenu = buildContextMenu(gasPrices);
        tray.setContextMenu(contextMenu);
        logger.debug('Gas prices updated', gasPrices);
      }
    } catch (error) {
      logger.error('Failed to update gas prices', error);
    }
  };
  
  // Initial menu without gas prices
  const initialMenu = buildContextMenu();
  tray.setContextMenu(initialMenu);
  
  // Handle click to show menu
  tray.on('click', () => {
    tray.popUpContextMenu();
  });
  
  // Start updating gas prices every minute
  // Initial update after a short delay to let server start
  setTimeout(() => {
    updateGasPrices();
    // Then update every minute
    updateInterval = setInterval(updateGasPrices, 60000);
  }, 5000);
  
  // Clean up interval when tray is destroyed
  const originalDestroy = tray.destroy.bind(tray);
  tray.destroy = () => {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
    originalDestroy();
  };
  
  return tray;
}

