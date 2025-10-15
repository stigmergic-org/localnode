import express from 'express';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import path from 'path';
import { generateCertificates } from '../certificates/certificates.js';
import { ENSResolver } from '../ethereum/ens-resolver.js';
import { setupRoutes } from '../utils/routes.js';
import { setupRpcRoutes } from '../utils/rpc-routes.js';
import { HeliosClient } from '../ethereum/helios-client.js';
import { IPFSManager } from '../ipfs/ipfs-manager.js';
import { getAllCachedDomains, getDomainFavicon, getDomainSizes, clearDomainCache, enableAutoSeeding, disableAutoSeeding, isAutoSeedingEnabled } from '../utils/cache-api.js';
import { saveCidIfChanged } from '../utils/cache-manager.js';
import { CID } from 'multiformats/cid';
import { createLogger } from '../utils/logger.js';
import { createLoggingMiddleware, createErrorLoggingMiddleware } from '../utils/logging-middleware.js';

/**
 * Format bytes into human readable format
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * LocalNodeServer - Manages the Express server, HTTPS, Helios client, and ENS resolution
 */
export class LocalNodeServer {
  constructor(options = {}) {
    this.options = {
      port: options.port,
      consensusRpc: options.consensusRpc,
      executionRpc: options.executionRpc,
      domain: options.domain,
      certDir: options.certDir || './certs',
      ...options
    };
    
    // Create logger for this server instance
    this.logger = createLogger('LocalNodeServer');
    
    // Main app for ENS proxy
    this.app = express();
    
    // RPC app for Ethereum JSON-RPC
    this.rpcApp = express();
    
    // Node cache management app
    this.nodeCacheApp = express();
    
    // IPFS Manager (uses standard ports since we only start when they're free)
    this.ipfsManager = new IPFSManager();
    
    this.heliosClient = new HeliosClient({
      consensusRpc: this.options.consensusRpc,
      executionRpc: this.options.executionRpc
    });
    this.ensResolver = new ENSResolver(this.heliosClient);
    
    this.shutdownHandlersRegistered = false;
    this.autoSeedingInterval = null;
    this.autoSeedingIntervalMs = (options.autoSeedingIntervalMinutes || 10) * 60 * 1000; // Default 10 minutes
    
    this.setupMiddleware();
    // Note: setupRoutes() is called in start() after IPFS is initialized
  }

  setupMiddleware() {
    // Middleware for main ENS proxy app
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(createLoggingMiddleware('ENS'));
    this.app.use(createErrorLoggingMiddleware('ENS'));
    
    // Middleware for RPC app
    this.rpcApp.use(express.json());
    this.rpcApp.use(express.urlencoded({ extended: true }));
    this.rpcApp.use(createLoggingMiddleware('RPC'));
    this.rpcApp.use(createErrorLoggingMiddleware('RPC'));
    
    // Middleware for node cache management app
    this.nodeCacheApp.use(express.json());
    this.nodeCacheApp.use(express.urlencoded({ extended: true }));
    this.nodeCacheApp.use(createLoggingMiddleware('CACHE'));
    this.nodeCacheApp.use(createErrorLoggingMiddleware('CACHE'));
  }

  setupRoutes() {
    // Setup ENS proxy routes
    setupRoutes(this.app, this.ensResolver, { ...this.options, ipfsManager: this.ipfsManager });
    
    // Setup RPC routes
    setupRpcRoutes(this.rpcApp, this.heliosClient);
    
    // Setup node cache management routes
    this.setupNodeCacheRoutes();
  }

  setupNodeCacheRoutes() {
    // Serve the node cache management page
    this.nodeCacheApp.get('/', (req, res) => {
      const indexPath = path.join(process.cwd(), 'src', 'renderer', 'node-cache', 'index.html');
      res.sendFile(indexPath);
    });
    
    // Serve favicon
    this.nodeCacheApp.get('/favicon.svg', (req, res) => {
      const faviconPath = path.join(process.cwd(), 'assets', 'logo.svg');
      res.sendFile(faviconPath);
    });
    
    this.nodeCacheApp.get('/favicon.png', (req, res) => {
      const faviconPath = path.join(process.cwd(), 'assets', 'logo.png');
      res.sendFile(faviconPath);
    });
    
    this.nodeCacheApp.get('/icon.svg', (req, res) => {
      const iconPath = path.join(process.cwd(), 'assets', 'icon.svg');
      res.sendFile(iconPath);
    });
    
    // API endpoint to get all cached domains (fast - just domain + CID)
    this.nodeCacheApp.get('/api/cached-domains', (req, res) => {
      try {
        this.logger.debug('Getting cached domains');
        const domains = getAllCachedDomains();
        this.logger.info(`Returning ${domains.length} domains`);
        res.json(domains);
      } catch (error) {
        this.logger.error('Error getting cached domains', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API endpoint to get favicon for a specific domain
    this.nodeCacheApp.get('/api/domain-favicon', async (req, res) => {
      const domain = req.query.domain;
      if (!domain) {
        return res.status(400).json({ error: 'Domain parameter is required' });
      }
      
      try {
        const favicon = await getDomainFavicon(domain, this.ipfsManager);
        res.json({ favicon });
      } catch (error) {
        this.logger.error(`Error getting favicon for ${domain}`, error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API endpoint to get sizes for a specific domain
    this.nodeCacheApp.get('/api/domain-sizes', async (req, res) => {
      const domain = req.query.domain;
      if (!domain) {
        return res.status(400).json({ error: 'Domain parameter is required' });
      }
      
      try {
        const sizes = await getDomainSizes(domain, this.ipfsManager);
        res.json(sizes);
      } catch (error) {
        this.logger.error(`Error getting sizes for ${domain}`, error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API endpoint to clear cache for a domain
    this.nodeCacheApp.post('/api/clear-cache', async (req, res) => {
      const domain = req.query.domain;
      if (!domain) {
        return res.status(400).json({ error: 'Domain parameter is required' });
      }
      
      try {
        const success = await clearDomainCache(domain, this.ipfsManager);
        res.json({ success });
      } catch (error) {
        this.logger.error('Error clearing cache', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API endpoint to toggle auto-seeding for a domain
    this.nodeCacheApp.post('/api/toggle-auto-seed', async (req, res) => {
      const domain = req.query.domain;
      const enable = req.query.enable === 'true';
      
      if (!domain) {
        return res.status(400).json({ error: 'Domain parameter is required' });
      }
      
      try {
        const success = enable 
          ? await enableAutoSeeding(domain, this.ipfsManager)
          : await disableAutoSeeding(domain, this.ipfsManager);
        res.json({ success });
      } catch (error) {
        this.logger.error('Error toggling auto-seed', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API endpoint to get total storage used
    this.nodeCacheApp.get('/api/total-storage', async (req, res) => {
      try {
        const client = this.ipfsManager.getClient();
        const stat = await client.files.stat('/localnode-cache', { withLocal: true });
        const totalUsed = stat.sizeLocal || 0;
        res.json({ totalUsed: formatBytes(totalUsed) });
      } catch (error) {
        this.logger.error('Error getting total storage', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * Start the auto-seeding update loop
   */
  startAutoSeedingLoop() {
    if (this.autoSeedingInterval) {
      return; // Already running
    }
    
    this.logger.info(`Starting auto-seeding update loop (every ${this.autoSeedingIntervalMs / 60000} minutes)`);
    
    // Run immediately, then on interval
    this.checkAutoSeedingUpdates();
    
    this.autoSeedingInterval = setInterval(() => {
      this.checkAutoSeedingUpdates();
    }, this.autoSeedingIntervalMs);
  }

  /**
   * Stop the auto-seeding update loop
   */
  stopAutoSeedingLoop() {
    if (this.autoSeedingInterval) {
      clearInterval(this.autoSeedingInterval);
      this.autoSeedingInterval = null;
      this.logger.info('Stopped auto-seeding update loop');
    }
  }

  /**
   * Check for updates on all auto-seeding domains
   */
  async checkAutoSeedingUpdates() {
    try {
      this.logger.debug('Checking for updates');
      
      // Get all cached domains
      const domains = getAllCachedDomains();
      
      // Filter to only auto-seeding domains
      const autoSeedingDomains = domains.filter(d => d.autoSeeding);
      
      if (autoSeedingDomains.length === 0) {
        this.logger.debug('No domains to check');
        return;
      }
      
      this.logger.info(`Checking ${autoSeedingDomains.length} domains for updates`);
      
      // Check each domain for updates
      for (const domain of autoSeedingDomains) {
        try {
          await this.checkDomainUpdate(domain);
        } catch (error) {
          this.logger.error(`Error checking ${domain.domain}`, error);
        }
      }
      
      this.logger.debug('Update check completed');
    } catch (error) {
      this.logger.error('Error in update check', error);
    }
  }

  /**
   * Check for updates on a specific domain
   */
  async checkDomainUpdate(cachedDomain) {
    try {
      const domain = cachedDomain.domain;
      const oldCid = cachedDomain.cid;
      
      // Resolve current CID from ENS
      const newCid = await this.ensResolver.resolveENS(domain);
      
      // Parse CIDs for proper comparison
      const oldCidObj = CID.parse(oldCid);
      const newCidObj = CID.parse(newCid);
      
      // Use CID.equals() for proper comparison
      if (oldCidObj.equals(newCidObj)) {
        this.logger.debug(`${domain} is up to date (${newCid.substring(0, 20)}...)`);
        return;
      }
      
      this.logger.info(`${domain} has update: ${oldCid.substring(0, 20)}... → ${newCid.substring(0, 20)}...`);
      
      // Update the domain
      await this.updateAutoSeedingDomain(domain, newCid);
      
    } catch (error) {
      this.logger.error(`Error checking ${cachedDomain.domain}`, error);
    }
  }

  /**
   * Update an auto-seeding domain with new CID
   */
  async updateAutoSeedingDomain(domain, newCid) {
    try {
      const client = this.ipfsManager.getClient();
      
      // 1. Add to MFS cache
      const mfsPath = `/localnode-cache/${newCid}`;
      await client.files.cp(`/ipfs/${newCid}`, mfsPath, { parents: true });
      this.logger.debug(`Added ${newCid} to MFS cache`);
      
      // 2. Pin recursively
      await client.pin.add(newCid, { recursive: true });
      this.logger.debug(`Pinned ${newCid} recursively`);
      
      // 3. Add to filesystem cache
      await saveCidIfChanged(domain, newCid);
      this.logger.debug(`Updated cache for ${domain}`);
      
      this.logger.info(`Successfully updated ${domain} to ${newCid.substring(0, 20)}...`);
      
    } catch (error) {
      this.logger.error(`Error updating ${domain}`, error);
      throw error;
    }
  }

  async start() {
    try {
      // Initialize IPFS (check for existing or start managed instance)
      // IPFSManager will automatically fetch the gateway URL from IPFS config
      this.logger.info('Initializing IPFS');
      const ipfsConfig = await this.ipfsManager.initialize();
      
      // Update options with gateway URL
      this.options.ipfsGateway = ipfsConfig.gatewayUrl;
      
      // Setup routes now that IPFS is initialized and gateway URL is available
      this.setupRoutes();
      
      // Generate SSL certificates using OpenSSL CA and get the CA instance
      this.opensslCA = await generateCertificates(this.options.certDir, this.options.domain);
      
      // Read default SSL certificates for initial setup
      // Default *.eth.localhost cert is signed by root CA (2-level chain)
      const defaultKey = fs.readFileSync(path.join(this.options.certDir, 'server-key.pem'));
      const ethCert = fs.readFileSync(path.join(this.options.certDir, 'eth-cert.pem'), 'utf8');
      const rootCert = fs.readFileSync(path.join(this.options.certDir, 'root-ca-cert.pem'), 'utf8');
      
      // Concatenate eth cert with root for full chain (no intermediate for default cert)
      const defaultCert = ethCert + '\n' + rootCert;
      
      this.logger.info('Loaded SSL certificates');
      this.logger.debug(`Key size: ${defaultKey.length} bytes`);
      this.logger.debug(`Cert chain size: ${defaultCert.length} bytes`);
      
      // HTTPS options with SNI callback for dynamic certificate loading
      const httpsOptions = {
        key: defaultKey,
        cert: defaultCert,
        // SNI callback for dynamic certificate selection based on hostname (for subdomain support)
        SNICallback: this.opensslCA.getSNICallback(this.options.domain)
      };

      // Create a router to handle both ENS and RPC requests on HTTPS
      const combinedApp = express();
      
    // Route based on host header
    combinedApp.use((req, res, next) => {
      const host = req.headers.host || '';
      
      // Check if this is an RPC request (ethereum.node.localhost)
      if (host.includes('ethereum.node.')) {
        return this.rpcApp(req, res, next);
      }
      
      // Check if this is a node cache management request (node.localhost)
      if (host.includes('node.localhost')) {
        return this.nodeCacheApp(req, res, next);
      }
      
      // Otherwise, handle as ENS proxy
      return this.app(req, res, next);
    });

      // Start HTTPS server on port 443 (handles both ENS and RPC requests)
      this.httpsServer = createHttpsServer(httpsOptions, combinedApp);

      this.httpsServer.listen(this.options.port, () => {
        this.logger.info(`🔒 HTTPS server listening on port ${this.options.port}`);
        this.logger.info(`   ENS sites: https://your-domain.eth.${this.options.domain}`);
        this.logger.info(`   Example: https://vitalik.eth.${this.options.domain}`);
        this.logger.info(`   Ethereum RPC: https://ethereum.node.${this.options.domain}`);
        this.logger.info('Note: Requests will be queued until Helios finishes syncing');
      });

      // Start Helios light client in the background (don't block server startup)
      this.heliosClient.start().then(() => {
        // Initialize ENS resolver with Helios transport once synced
        this.ensResolver.init();
        this.logger.info('✅ Server is now fully ready to handle ENS and RPC requests');
        
        // Start auto-seeding update loop once ENS resolver is ready
        this.startAutoSeedingLoop();
      }).catch(error => {
        this.logger.error('❌ Failed to start Helios client', error);
        this.logger.warn('Server will continue to run but ENS resolution and RPC will not work');
      });

      // Graceful shutdown handlers (register only once)
      if (!this.shutdownHandlersRegistered) {
        const shutdown = async (signal) => {
          this.logger.info(`${signal} received - shutting down servers`);
          await this.stop();
          process.exit(0);
        };
        
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        
        this.shutdownHandlersRegistered = true;
      }

    } catch (error) {
      throw new Error(`Failed to start server: ${error.message}`);
    }
  }

  async stop() {
    return new Promise(async (resolve) => {
      // Stop auto-seeding loop first
      this.stopAutoSeedingLoop();
      
      // Stop Helios client
      if (this.heliosClient) {
        await this.heliosClient.stop();
      }
      
      // Stop managed IPFS instance if running
      if (this.ipfsManager) {
        await this.ipfsManager.stop();
      }
      
      // Clean up dynamically generated certificates
      if (this.opensslCA) {
        this.opensslCA.cleanup();
      }
      
      if (this.httpsServer) {
        this.httpsServer.close(() => {
          this.logger.info('Server stopped successfully');
          resolve();
        });
      } else {
        this.logger.info('Server stopped successfully');
        resolve();
      }
    });
  }

  async restart(newOptions) {
    this.logger.info('Restarting server with new configuration');
    await this.stop();
    
    // Update options
    this.options = {
      ...this.options,
      ...newOptions
    };
    
    // Update Helios client and ENS resolver with new configuration
    if (newOptions.consensusRpc || newOptions.executionRpc) {
      this.heliosClient = new HeliosClient({
        consensusRpc: this.options.consensusRpc,
        executionRpc: this.options.executionRpc
      });
      this.ensResolver = new ENSResolver(this.heliosClient);
    }
    
    // Recreate the apps
    this.app = express();
    this.rpcApp = express();
    this.nodeCacheApp = express();
    this.setupMiddleware();
    // Note: setupRoutes() will be called in start() after IPFS is initialized
    
    await this.start();
  }
}

/**
 * Start the server
 * @param {Object} options - Server options
 * @returns {Promise<LocalNodeServer>} The server instance
 */
export async function startServer(options) {
  const server = new LocalNodeServer(options);
  await server.start();
  return server;
}

