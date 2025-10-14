import { createHeliosProvider } from '@a16z/helios';
import { createLogger } from '../utils/logger.js';
import { custom } from 'viem';

/**
 * HeliosClient - Manages the Helios light client instance
 */
class HeliosClient {
  constructor(options = {}) {
    this.consensusRpc = options.consensusRpc;
    this.executionRpc = options.executionRpc;
    this.logger = createLogger('HeliosClient');
    this.provider = null;
    this.isStarted = false;
    this.syncPromise = null; // Promise that resolves when synced
  }

  /**
   * Initialize and start the Helios client
   */
  async start() {
    if (this.isStarted) {
      this.logger.debug('Helios client already started');
      return;
    }

    if (this.syncPromise) {
      this.logger.debug('Helios client already starting, waiting for sync');
      return this.syncPromise;
    }

    // Create a promise that will resolve when synced
    this.syncPromise = (async () => {
      try {
        this.logger.info('Starting Helios light client');
        this.logger.info(`Consensus RPC: ${this.consensusRpc}`);
        this.logger.info(`Execution RPC: ${this.executionRpc}`);

        // Create Helios provider
        this.provider = await createHeliosProvider({
          network: 'mainnet',
          consensusRpc: this.consensusRpc,
          executionRpc: this.executionRpc,
          // checkpoint: '0x0958d83550263ff0d9f9a0bc5ea3cd2a136e0933b6f43cbb17f36e4da8d809b1',
          // Let Helios auto-fetch the checkpoint from fallback service
          // Specifying a manual checkpoint can cause WASM panics if invalid/old
        }, 'ethereum');

        // Wait for sync to complete
        this.logger.info('Waiting for Helios to sync');
        await this.provider.waitSynced();
        
        this.isStarted = true;
        this.logger.info('Helios light client started and synced successfully');
      } catch (error) {
        this.logger.error('Failed to start Helios client', error);
        this.syncPromise = null; // Reset so it can be retried
        throw error;
      }
    })();

    return this.syncPromise;
  }

  /**
   * Wait for Helios to be synced and ready
   */
  async waitForSync() {
    if (this.isStarted) {
      return; // Already synced
    }
    if (this.syncPromise) {
      return this.syncPromise; // Wait for ongoing sync
    }
    throw new Error('Helios client not started. Call start() first.');
  }

  /**
   * Stop the Helios client
   */
  async stop() {
    if (!this.isStarted || !this.provider) {
      return;
    }

    try {
      this.logger.info('Stopping Helios light client');
      // Note: Helios provider may not have a stop method
      // Just clean up our references
      this.isStarted = false;
      this.provider = null;
      this.logger.info('Helios light client stopped');
    } catch (error) {
      this.logger.error('Error stopping Helios client', error);
      throw error;
    }
  }

  /**
   * Get the Helios provider instance
   * @returns {HeliosProvider} The Helios provider instance
   */
  getProvider() {
    if (!this.isStarted || !this.provider) {
      throw new Error('Helios provider not started. Call start() first.');
    }
    return this.provider;
  }

  /**
   * Check if the client is started
   */
  isReady() {
    return this.isStarted && this.provider !== null;
  }

  /**
   * Make an RPC call using Helios
   */
  async request(method, params = []) {
    if (!this.isReady()) {
      throw new Error('Helios provider not ready');
    }

    try {
      const result = await this.provider.request({ method, params });
      return result;
    } catch (error) {
      this.logger.error(`Helios RPC error (${method})`, error);
      throw error;
    }
  }

  /**
   * Get a viem transport that uses this Helios provider
   * @returns {Transport} A viem transport
   */
  getTransport() {
    if (!this.isReady()) {
      throw new Error('Helios provider not ready');
    }
    // Use viem's custom transport with the Helios provider
    return custom(this.provider);
  }
}

export { HeliosClient };

