import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getAllCachedDomains, 
  getDomainFavicon, 
  getDomainSizes, 
  clearDomainCache,
  enableAutoSeeding,
  disableAutoSeeding
} from './cache-api.js';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('NodeCacheRoutes');

/**
 * Format bytes into human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Setup node cache management routes
 * @param {Express} app - Express app instance
 * @param {IPFSManager} ipfsManager - IPFS manager instance
 */
export function setupNodeCacheRoutes(app, ipfsManager) {
  // Serve the node cache management page
  app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '..', 'renderer', 'node-cache', 'index.html');
    res.sendFile(indexPath);
  });
  
  // Serve favicon
  app.get('/favicon.svg', (req, res) => {
    const faviconPath = path.join(__dirname, '..', '..', 'assets', 'logo.svg');
    res.sendFile(faviconPath);
  });
  
  app.get('/favicon.png', (req, res) => {
    const faviconPath = path.join(__dirname, '..', '..', 'assets', 'logo.png');
    res.sendFile(faviconPath);
  });
  
  app.get('/icon.svg', (req, res) => {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.svg');
    res.sendFile(iconPath);
  });
  
  // API endpoint to get all cached domains (fast - just domain + CID)
  app.get('/api/cached-domains', (req, res) => {
    try {
      logger.debug('Getting cached domains');
      const domains = getAllCachedDomains();
      logger.info(`Returning ${domains.length} domains`);
      res.json(domains);
    } catch (error) {
      logger.error('Error getting cached domains', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // API endpoint to get favicon for a specific domain
  app.get('/api/domain-favicon', async (req, res) => {
    const domain = req.query.domain;
    if (!domain) {
      return res.status(400).json({ error: 'Domain parameter is required' });
    }
    
    try {
      const favicon = await getDomainFavicon(domain, ipfsManager);
      res.json({ favicon });
    } catch (error) {
      logger.error(`Error getting favicon for ${domain}`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // API endpoint to get sizes for a specific domain
  app.get('/api/domain-sizes', async (req, res) => {
    const domain = req.query.domain;
    if (!domain) {
      return res.status(400).json({ error: 'Domain parameter is required' });
    }
    
    try {
      const sizes = await getDomainSizes(domain, ipfsManager);
      res.json(sizes);
    } catch (error) {
      logger.error(`Error getting sizes for ${domain}`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // API endpoint to clear cache for a domain
  app.post('/api/clear-cache', async (req, res) => {
    const domain = req.query.domain;
    if (!domain) {
      return res.status(400).json({ error: 'Domain parameter is required' });
    }
    
    try {
      const success = await clearDomainCache(domain, ipfsManager);
      res.json({ success });
    } catch (error) {
      logger.error('Error clearing cache', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // API endpoint to toggle auto-seeding for a domain
  app.post('/api/toggle-auto-seed', async (req, res) => {
    const domain = req.query.domain;
    const enable = req.query.enable === 'true';
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain parameter is required' });
    }
    
    try {
      const success = enable 
        ? await enableAutoSeeding(domain, ipfsManager)
        : await disableAutoSeeding(domain, ipfsManager);
      res.json({ success });
    } catch (error) {
      logger.error('Error toggling auto-seed', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // API endpoint to get total storage used
  app.get('/api/total-storage', async (req, res) => {
    try {
      const client = ipfsManager.getClient();
      const stat = await client.files.stat('/localnode-cache', { withLocal: true });
      const totalUsed = stat.sizeLocal || 0;
      res.json({ totalUsed: formatBytes(totalUsed) });
    } catch (error) {
      logger.error('Error getting total storage', error);
      res.status(500).json({ error: error.message });
    }
  });
}

