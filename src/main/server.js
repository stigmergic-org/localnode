import express from 'express';
import { createServer } from 'https';
import fs from 'fs';
import path from 'path';
import { generateCertificates } from '../certificates/certificates.js';
import { ENSResolver } from '../ethereum/ens-resolver.js';
import { setupRoutes } from '../utils/routes.js';
import { HeliosClient } from '../ethereum/helios-client.js';

/**
 * Fetch the IPFS gateway URL from the IPFS API
 * @param {string} apiUrl - The IPFS API URL
 * @returns {Promise<string>} The gateway URL
 */
async function fetchGatewayUrl(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/api/v0/config?arg=Addresses.Gateway`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      throw new Error(`IPFS API returned ${response.status}`);
    }
    
    const data = await response.json();
    const gatewayAddress = data.Value;
    
    // Convert the gateway address to a full URL
    // Gateway address is typically in format "/ip4/127.0.0.1/tcp/8080"
    if (gatewayAddress.includes('/ip4/')) {
      const match = gatewayAddress.match(/\/ip4\/([^/]+)\/tcp\/(\d+)/);
      if (match) {
        const [, ip, port] = match;
        return `http://${ip}:${port}`;
      }
    }
    
    // Fallback to default if we can't parse it
    console.warn(`Could not parse gateway address: ${gatewayAddress}, using default`);
    return 'http://localhost:8080';
  } catch (error) {
    console.warn(`Failed to fetch gateway URL from IPFS API: ${error.message}`);
    console.warn('Using default gateway URL: http://localhost:8080');
    return 'http://localhost:8080';
  }
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
      ipfsApiUrl: options.ipfsApiUrl,
      domain: options.domain,
      certDir: options.certDir || './certs',
      ...options
    };
    
    this.app = express();
    this.heliosClient = new HeliosClient({
      consensusRpc: this.options.consensusRpc,
      executionRpc: this.options.executionRpc
    });
    this.ensResolver = new ENSResolver(this.heliosClient);
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${req.get('host')}`);
      next();
    });
  }

  setupRoutes() {
    setupRoutes(this.app, this.ensResolver, this.options);
  }

  async start() {
    try {
      // Fetch gateway URL from IPFS API
      console.log(`Fetching IPFS gateway URL from API: ${this.options.ipfsApiUrl}`);
      this.options.ipfsGateway = await fetchGatewayUrl(this.options.ipfsApiUrl);
      console.log(`Using IPFS gateway: ${this.options.ipfsGateway}`);
      
      // Generate SSL certificates using local CA
      await generateCertificates(this.options.certDir, this.options.domain);
      
      // Start HTTPS server immediately (before Helios is synced)
      const httpsOptions = {
        key: fs.readFileSync(path.join(this.options.certDir, 'key.pem')),
        cert: fs.readFileSync(path.join(this.options.certDir, 'cert.pem'))
      };

      this.httpsServer = createServer(httpsOptions, this.app);

      this.httpsServer.listen(this.options.port, () => {
        console.log(`HTTPS server listening on port ${this.options.port}`);
        console.log(`Access ENS sites at: https://your-domain.eth.${this.options.domain}`);
        console.log(`Example: https://vitalik.eth.${this.options.domain}`);
        console.log('Note: Requests will be queued until Helios finishes syncing...');
      });

      // Start Helios light client in the background (don't block server startup)
      this.heliosClient.start().then(() => {
        // Initialize ENS resolver with Helios transport once synced
        this.ensResolver.init();
        console.log('Server is now fully ready to handle ENS requests');
      }).catch(error => {
        console.error('Failed to start Helios client:', error);
        console.error('Server will continue to run but ENS resolution will not work');
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
    
    // Recreate the app with new routes
    this.app = express();
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

