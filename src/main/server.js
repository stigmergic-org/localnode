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
    
    // Main app for ENS proxy
    this.app = express();
    
    // RPC app for Ethereum JSON-RPC
    this.rpcApp = express();
    
    // IPFS Manager (uses standard ports since we only start when they're free)
    this.ipfsManager = new IPFSManager();
    
    this.heliosClient = new HeliosClient({
      consensusRpc: this.options.consensusRpc,
      executionRpc: this.options.executionRpc
    });
    this.ensResolver = new ENSResolver(this.heliosClient);
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Middleware for main ENS proxy app
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Logging middleware for ENS app
    this.app.use((req, res, next) => {
      console.log(`[ENS] ${new Date().toISOString()} - ${req.method} ${req.url} - ${req.get('host')}`);
      next();
    });
    
    // Middleware for RPC app
    this.rpcApp.use(express.json());
    this.rpcApp.use(express.urlencoded({ extended: true }));
    
    // Logging middleware for RPC app
    this.rpcApp.use((req, res, next) => {
      console.log(`[RPC] ${new Date().toISOString()} - ${req.method} ${req.url} - ${req.get('host')}`);
      next();
    });
  }

  setupRoutes() {
    // Setup ENS proxy routes
    setupRoutes(this.app, this.ensResolver, this.options);
    
    // Setup RPC routes
    setupRpcRoutes(this.rpcApp, this.heliosClient);
  }

  async start() {
    try {
      // Initialize IPFS (check for existing or start managed instance)
      // IPFSManager will automatically fetch the gateway URL from IPFS config
      console.log('Initializing IPFS...');
      const ipfsConfig = await this.ipfsManager.initialize();
      
      // Update options with gateway URL
      this.options.ipfsGateway = ipfsConfig.gatewayUrl;
      
      // Generate SSL certificates using local CA
      await generateCertificates(this.options.certDir, this.options.domain);
      
      // Read SSL certificates
      // Include CA certificate in the chain for proper validation
      const httpsOptions = {
        key: fs.readFileSync(path.join(this.options.certDir, 'key.pem')),
        cert: fs.readFileSync(path.join(this.options.certDir, 'cert.pem')),
        ca: fs.readFileSync(path.join(this.options.certDir, 'ca-cert.pem'))
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
        
        // Otherwise, handle as ENS proxy
        return this.app(req, res, next);
      });

      // Start HTTPS server on port 443 (handles both ENS and RPC requests)
      this.httpsServer = createHttpsServer(httpsOptions, combinedApp);

      this.httpsServer.listen(this.options.port, () => {
        console.log(`\n🔒 HTTPS server listening on port ${this.options.port}`);
        console.log(`   ENS sites: https://your-domain.eth.${this.options.domain}`);
        console.log(`   Example: https://vitalik.eth.${this.options.domain}`);
        console.log(`   Ethereum RPC: https://ethereum.node.${this.options.domain}`);
        console.log('\nNote: Requests will be queued until Helios finishes syncing...\n');
      });

      // Start Helios light client in the background (don't block server startup)
      this.heliosClient.start().then(() => {
        // Initialize ENS resolver with Helios transport once synced
        this.ensResolver.init();
        console.log('✅ Server is now fully ready to handle ENS and RPC requests\n');
      }).catch(error => {
        console.error('❌ Failed to start Helios client:', error);
        console.error('Server will continue to run but ENS resolution and RPC will not work\n');
      });

      // Graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down servers...');
        this.stop();
        process.exit(0);
      });

    } catch (error) {
      throw new Error(`Failed to start server: ${error.message}`);
    }
  }

  async stop() {
    return new Promise(async (resolve) => {
      // Stop Helios client first
      if (this.heliosClient) {
        await this.heliosClient.stop();
      }
      
      // Stop managed IPFS instance if running
      if (this.ipfsManager) {
        await this.ipfsManager.stop();
      }
      
      if (this.httpsServer) {
        this.httpsServer.close(() => {
          console.log('Server stopped successfully');
          resolve();
        });
      } else {
        console.log('Server stopped successfully');
        resolve();
      }
    });
  }

  async restart(newOptions) {
    console.log('Restarting server with new configuration...');
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
    
    // Recreate the apps with new routes
    this.app = express();
    this.rpcApp = express();
    this.setupMiddleware();
    this.setupRoutes();
    
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

