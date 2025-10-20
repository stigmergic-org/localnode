import express from 'express';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificates } from '../certificates/certificates.js';
import { ENSResolver } from '../ethereum/ens-resolver.js';
import { setupRoutes } from '../utils/routes.js';
import { setupRpcRoutes } from '../utils/rpc-routes.js';
import { setupNodeCacheRoutes } from '../utils/node-cache-routes.js';
import { HeliosClient } from '../ethereum/helios-client.js';
import { IPFSManager } from '../ipfs/ipfs-manager.js';
import { AutoSeeding } from '../utils/auto-seeding.js';
import { createLogger } from '../utils/logger.js';
import { createLoggingMiddleware, createErrorLoggingMiddleware } from '../utils/logging-middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      autoSeedingIntervalMinutes: options.autoSeedingIntervalMinutes || 10,
      ...options
    };
    
    this.logger = createLogger('Server');
    
    // Initialize components
    this.ipfsManager = new IPFSManager();
    this.heliosClient = new HeliosClient({
      consensusRpc: this.options.consensusRpc,
      executionRpc: this.options.executionRpc
    });
    this.ensResolver = new ENSResolver(this.heliosClient);
    this.autoSeeding = null; // Initialized after ENS resolver is ready
    
    // Express apps
    this.ensApp = express();
    this.rpcApp = express();
    this.nodeCacheApp = express();
    
    // Server state
    this.httpsServer = null;
    this.opensslCA = null;
    
    this.setupMiddleware();
  }

  /**
   * Setup middleware for all Express apps
   */
  setupMiddleware() {
    // ENS proxy app middleware
    this.ensApp.use(express.json());
    this.ensApp.use(express.urlencoded({ extended: true }));
    this.ensApp.use(createLoggingMiddleware('ENS'));
    this.ensApp.use(createErrorLoggingMiddleware('ENS'));
    
    // RPC app middleware
    this.rpcApp.use(express.json());
    this.rpcApp.use(express.urlencoded({ extended: true }));
    this.rpcApp.use(createLoggingMiddleware('RPC'));
    this.rpcApp.use(createErrorLoggingMiddleware('RPC'));
    
    // Node cache app middleware
    this.nodeCacheApp.use(express.json());
    this.nodeCacheApp.use(express.urlencoded({ extended: true }));
    this.nodeCacheApp.use(createLoggingMiddleware('CACHE'));
    this.nodeCacheApp.use(createErrorLoggingMiddleware('CACHE'));
  }

  /**
   * Setup routes for all Express apps
   */
  setupRoutes() {
    setupRoutes(this.ensApp, this.ensResolver, { 
      ...this.options, 
      ipfsManager: this.ipfsManager 
    });
    
    setupRpcRoutes(this.rpcApp, this.heliosClient);
    
    setupNodeCacheRoutes(this.nodeCacheApp, this.ipfsManager);
  }

  /**
   * Initialize IPFS
   */
  async initializeIPFS() {
    this.logger.info('Initializing IPFS');
    const ipfsConfig = await this.ipfsManager.initialize();
    this.options.ipfsGateway = ipfsConfig.gatewayUrl;
    this.logger.info('IPFS initialized', { gatewayUrl: ipfsConfig.gatewayUrl });
  }

  /**
   * Initialize SSL certificates
   */
  async initializeSSL() {
    this.logger.info('Initializing SSL certificates');
    
    // Generate SSL certificates using OpenSSL CA
    this.opensslCA = await generateCertificates(this.options.certDir, this.options.domain);
    
    // Read default SSL certificates
    const defaultKey = fs.readFileSync(path.join(this.options.certDir, 'server-key.pem'));
    const ethCert = fs.readFileSync(path.join(this.options.certDir, 'eth-cert.pem'), 'utf8');
    const rootCert = fs.readFileSync(path.join(this.options.certDir, 'root-ca-cert.pem'), 'utf8');
    
    // Concatenate eth cert with root for full chain
    const defaultCert = ethCert + '\n' + rootCert;
    
    this.logger.debug('SSL certificates loaded', {
      keySize: defaultKey.length,
      certChainSize: defaultCert.length
    });
    
    return {
      key: defaultKey,
      cert: defaultCert,
      SNICallback: this.opensslCA.getSNICallback(this.options.domain)
    };
  }

  /**
   * Create combined Express app that routes to appropriate sub-app
   */
  createCombinedApp() {
    const combinedApp = express();
    
    combinedApp.use((req, res, next) => {
      const host = req.headers.host || '';
      
      // Route to RPC app (ethereum.node.localhost)
      if (host.includes('ethereum.node.')) {
        return this.rpcApp(req, res, next);
      }
      
      // Route to node cache app (node.localhost)
      if (host.includes('node.localhost')) {
        return this.nodeCacheApp(req, res, next);
      }
      
      // Route to ENS proxy app
      return this.ensApp(req, res, next);
    });
    
    return combinedApp;
  }

  /**
   * Start HTTPS server
   */
  async startHTTPSServer(httpsOptions, combinedApp) {
    return new Promise((resolve) => {
      this.httpsServer = createHttpsServer(httpsOptions, combinedApp);
      
      this.httpsServer.listen(this.options.port, () => {
        this.logger.info(`🔒 HTTPS server listening on port ${this.options.port}`);
        this.logger.info(`   ENS sites: https://your-domain.eth.${this.options.domain}`);
        this.logger.info(`   Example: https://vitalik.eth.${this.options.domain}`);
        this.logger.info(`   Ethereum RPC: https://ethereum.node.${this.options.domain}`);
        this.logger.info('Note: Requests will be queued until Helios finishes syncing');
        resolve();
      });
    });
  }

  /**
   * Start Helios client and initialize ENS resolver
   */
  async startHeliosClient() {
    try {
      await this.heliosClient.start();
      this.ensResolver.init();
      this.logger.info('✅ Helios client started and ENS resolver initialized');
      
      // Initialize auto-seeding
      this.autoSeeding = new AutoSeeding(this.ensResolver, this.ipfsManager, {
        intervalMinutes: this.options.autoSeedingIntervalMinutes
      });
      this.autoSeeding.start();
      
    } catch (error) {
      this.logger.error('❌ Failed to start Helios client', error);
      this.logger.warn('Server will continue but ENS resolution and RPC will not work');
    }
  }


  /**
   * Start the server
   */
  async start() {
    try {
      // Initialize IPFS
      await this.initializeIPFS();
      
      // Setup routes (after IPFS is initialized)
      this.setupRoutes();
      
      // Initialize SSL certificates
      const httpsOptions = await this.initializeSSL();
      
      // Create combined app
      const combinedApp = this.createCombinedApp();
      
      // Start HTTPS server
      await this.startHTTPSServer(httpsOptions, combinedApp);
      
      // Start Helios client (async, don't block server startup)
      this.startHeliosClient();
      
    } catch (error) {
      throw new Error(`Failed to start server: ${error.message}`);
    }
  }

  /**
   * Stop the server
   */
  async stop() {
    return new Promise(async (resolve) => {
      // Stop auto-seeding
      if (this.autoSeeding) {
        this.autoSeeding.stop();
      }
      
      // Stop Helios client
      if (this.heliosClient) {
        await this.heliosClient.stop();
      }
      
      // Stop IPFS manager
      if (this.ipfsManager) {
        await this.ipfsManager.stop();
      }
      
      // Clean up SSL certificates
      if (this.opensslCA) {
        this.opensslCA.cleanup();
      }
      
      // Close HTTPS server
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

  /**
   * Restart the server with new configuration
   */
  async restart(newOptions) {
    this.logger.info('Restarting server with new configuration');
    await this.stop();
    
    // Update options
    this.options = {
      ...this.options,
      ...newOptions
    };
    
    // Update Helios client and ENS resolver if needed
    if (newOptions.consensusRpc || newOptions.executionRpc) {
      this.heliosClient = new HeliosClient({
        consensusRpc: this.options.consensusRpc,
        executionRpc: this.options.executionRpc
      });
      this.ensResolver = new ENSResolver(this.heliosClient);
    }
    
    // Recreate Express apps
    this.ensApp = express();
    this.rpcApp = express();
    this.nodeCacheApp = express();
    this.setupMiddleware();
    
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
