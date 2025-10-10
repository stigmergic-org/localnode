import { createHeliosProvider } from '@a16z/helios';
import { custom } from 'viem';

/**
 * HeliosClient - Manages the Helios light client instance
 */
class HeliosClient {
  constructor(options = {}) {
    this.consensusRpc = options.consensusRpc;
    this.executionRpc = options.executionRpc;
    this.provider = null;
    this.isStarted = false;
    this.syncPromise = null; // Promise that resolves when synced
  }

  /**
   * Initialize and start the Helios client
   */
  async start() {
    if (this.isStarted) {
      console.log('Helios client already started');
      return;
    }

    if (this.syncPromise) {
      console.log('Helios client already starting, waiting for sync...');
      return this.syncPromise;
    }

    // Create a promise that will resolve when synced
    this.syncPromise = (async () => {
      try {
        console.log('Starting Helios light client...');
        console.log(`Consensus RPC: ${this.consensusRpc}`);
        console.log(`Execution RPC: ${this.executionRpc}`);

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
        console.log('Waiting for Helios to sync...');
        await this.provider.waitSynced();
        
        this.isStarted = true;
        console.log('Helios light client started and synced successfully');
      } catch (error) {
        console.error('Failed to start Helios client:', error);
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
      console.log('Stopping Helios light client...');
      // Note: Helios provider may not have a stop method
      // Just clean up our references
      this.isStarted = false;
      this.provider = null;
      console.log('Helios light client stopped');
    } catch (error) {
      console.error('Error stopping Helios client:', error);
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
      console.error(`Helios RPC error (${method}):`, error);
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

