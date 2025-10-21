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

  /**
   * Fetch gas prices using eth_feeHistory from execution RPC directly
   * Helios doesn't support eth_feeHistory yet, so we call the execution RPC directly
   * @returns {Promise<{low: number, mid: number, high: number}|null>} Gas prices in gwei
   */
  async getGasPrices() {
    try {
      // Call the execution RPC directly since Helios doesn't support eth_feeHistory
      const response = await fetch(this.executionRpc, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_feeHistory',
          params: [
            '0xf', // 15 blocks in hex
            'latest',
            [10, 50, 95] // Standard percentiles: 10th (low), 50th (medium), 95th (high)
          ]
        })
      });

      if (!response.ok) {
        this.logger.error('Failed to fetch gas prices', { status: response.status });
        return null;
      }

      const data = await response.json();
      const result = data.result;

      if (!result || !result.baseFeePerGas || !result.reward) {
        return null;
      }

      // Get the latest base fee (last element)
      const latestBaseFee = BigInt(result.baseFeePerGas[result.baseFeePerGas.length - 1]);

      // Calculate average priority fees for each percentile
      const avgPriorityFees = [0, 1, 2].map(percentileIndex => {
        const sum = result.reward.reduce((acc, reward) => {
          return acc + BigInt(reward[percentileIndex] || '0x0');
        }, 0n);
        return sum / BigInt(result.reward.length);
      });

      // Convert to gwei (wei / 10^9) and add base fee + priority fee
      const toGwei = (wei) => Number(wei) / 1e9;
      
      return {
        low: Number(toGwei(latestBaseFee + avgPriorityFees[0]).toFixed(2)),
        mid: Number(toGwei(latestBaseFee + avgPriorityFees[1]).toFixed(2)),
        high: Number(toGwei(latestBaseFee + avgPriorityFees[2]).toFixed(2))
      };
    } catch (error) {
      this.logger.error('Failed to fetch gas prices', error);
      return null;
    }
  }
}

export { HeliosClient };

