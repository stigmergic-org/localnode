import { createNode } from 'ipfsd-ctl';
import { path as kuboPath } from 'kubo';
import { create as createKuboClient } from 'kubo-rpc-client';
import { getIpfsDir } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

// Standard IPFS API port - we check this and use it for managed instance
const IPFS_API_PORT = 5001;
// Custom gateway port for managed instance (less common to avoid conflicts)
const MANAGED_GATEWAY_PORT = 58080;

/**
 * IPFSManager - Manages IPFS/kubo lifecycle
 * Checks if kubo is already running on port 5001, otherwise starts an embedded instance
 */
export class IPFSManager {
  constructor(options = {}) {
    this.options = options;
    this.logger = createLogger('IPFSManager');
    
    this.node = null;
    this.client = null;
    this.ipfsGatewayUrl = null;
    this.isManaged = false;
  }

  /**
   * Check if IPFS is running on port 5001 and create client if found
   * @returns {Promise<boolean>} true if IPFS is running and accessible
   */
  async checkExistingIpfs() {
    try {
      // Create client to check
      this.client = createKuboClient({ url: `http://localhost:${IPFS_API_PORT}` });
      const version = await this.client.version();
      this.logger.info(`Found existing IPFS node: ${version.version} on port ${IPFS_API_PORT}`);
      
      return true;
    } catch (error) {
      // IPFS not running or not accessible
      return false;
    }
  }

  /**
   * Fetch the IPFS gateway URL from the IPFS API using kubo-rpc-client
   * @returns {Promise<string>} The gateway URL
   */
  async fetchGatewayUrl() {
    try {
      const gatewayAddress = await this.client.config.get('Addresses.Gateway');
      
      // Convert the gateway address to a full URL
      // Gateway address is typically in format "/ip4/127.0.0.1/tcp/8080"
      if (gatewayAddress && gatewayAddress.includes('/ip4/')) {
        const match = gatewayAddress.match(/\/ip4\/([^/]+)\/tcp\/(\d+)/);
        if (match) {
          const [, ip, port] = match;
          return `http://${ip}:${port}`;
        }
      }
      
      // Fallback to default if we can't parse it
      this.logger.warn(`Could not parse gateway address: ${gatewayAddress}, using default`);
      return 'http://localhost:8080';
    } catch (error) {
      this.logger.warn(`Failed to fetch gateway URL from IPFS API: ${error.message}`);
      this.logger.warn('Using default gateway URL: http://localhost:8080');
      return 'http://localhost:8080';
    }
  }

  /**
   * Start a managed IPFS instance using ipfsd-ctl and kubo
   * Uses standard API port (5001) and custom gateway port (58080) to avoid conflicts
   * @returns {Promise<void>}
   */
  async startManagedIpfs() {
    try {
      this.logger.info('Starting managed IPFS instance');
      this.logger.info(`  API Port: ${IPFS_API_PORT}`);
      this.logger.info(`  Gateway Port: ${MANAGED_GATEWAY_PORT} (custom to avoid conflicts)`);
      this.logger.info(`  WebUI: http://localhost:${IPFS_API_PORT}/webui`);
      
      // Create IPFS node using the proper ipfsd-ctl API
      const ipfsRepoPath = getIpfsDir();
      this.logger.info(`  Repo Path: ${ipfsRepoPath}`);
      
      this.node = await createNode({
        type: 'kubo',
        rpc: createKuboClient,
        bin: kuboPath(),
        repo: ipfsRepoPath,
        init: true,
        start: true,
        disposable: false,
        config: {
          Addresses: {
            Gateway: `/ip4/127.0.0.1/tcp/${MANAGED_GATEWAY_PORT}`
          },
          API: {
            HTTPHeaders: {
              'Access-Control-Allow-Origin': [
                'https://webui.ipfs.io',
              ],
              'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT'],
              'Access-Control-Allow-Headers': ['X-Requested-With', 'Content-Type']
            }
          }
        }
      });
      
      this.isManaged = true;
      
      // Get the API client from the node
      this.client = this.node.api;
      
      // Fetch actual gateway URL from IPFS configuration
      this.ipfsGatewayUrl = await this.fetchGatewayUrl();
      
      this.logger.info('Managed IPFS instance started successfully');
      this.logger.info(`   API: http://localhost:${IPFS_API_PORT}`);
      this.logger.info(`   Gateway: ${this.ipfsGatewayUrl}`);
      this.logger.info(`   WebUI: http://localhost:${IPFS_API_PORT}/webui`);
      
    } catch (error) {
      this.logger.error('Failed to start managed IPFS instance', error);
      throw error;
    }
  }

  /**
   * Initialize IPFS - check for existing instance or start managed one
   * @returns {Promise<{gatewayUrl: string, isManaged: boolean}>}
   */
  async initialize() {
    // First check if IPFS is already running on port 5001
    const hasExistingIpfs = await this.checkExistingIpfs();
    
    if (hasExistingIpfs) {
      // Use existing IPFS instance (client already created in checkExistingIpfs)
      this.isManaged = false;
      
      // Fetch actual gateway URL from existing IPFS configuration
      this.ipfsGatewayUrl = await this.fetchGatewayUrl();
      
      this.logger.info('Using existing IPFS installation');
      this.logger.info(`  API: http://localhost:${IPFS_API_PORT}`);
      this.logger.info(`  Gateway: ${this.ipfsGatewayUrl}`);
    } else {
      // Port 5001 is free, start our managed instance on standard ports
      this.logger.info('No existing IPFS found, starting managed instance on standard ports');
      await this.startManagedIpfs();
    }

    return {
      gatewayUrl: this.ipfsGatewayUrl,
      isManaged: this.isManaged
    };
  }

  /**
   * Get the kubo RPC client
   * @returns {object} The kubo-rpc-client instance
   */
  getClient() {
    return this.client;
  }

  /**
   * Get the IPFS Gateway URL
   * @returns {string}
   */
  getGatewayUrl() {
    return this.ipfsGatewayUrl;
  }

  /**
   * Check if this is a managed IPFS instance
   * @returns {boolean}
   */
  isManagedInstance() {
    return this.isManaged;
  }

  /**
   * Stop the managed IPFS instance (if running)
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.node && this.isManaged) {
      try {
        this.logger.info('Stopping managed IPFS instance');
        await this.node.stop();
        this.node = null;
        this.client = null;
        this.logger.info('Managed IPFS instance stopped');
      } catch (error) {
        this.logger.error('Error stopping managed IPFS instance', error);
        // Even if stop fails, clean up references
        this.node = null;
        this.client = null;
      }
    } else if (this.client && !this.isManaged) {
      // For external IPFS, just clear our client reference
      this.logger.info('Disconnecting from external IPFS instance');
      this.client = null;
    }
  }
}

