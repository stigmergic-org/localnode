import { createPublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { resolveEnsDomain } from '@simplepg/common';
import { getLatestCid } from '../utils/cache-manager.js';

class ENSResolver {
  constructor(heliosClient) {
    this.heliosClient = heliosClient;
    this.client = null;
    this.universalResolver = '0xc0497E381f536Be9ce14B0dD3817cBcAe57d2F62'; // UniversalResolver address
    
    // In-memory cache for ENS -> CID mappings with TTL
    this.memoryCache = new Map(); // { domain: { cid, expiresAt } }
    this.cacheTtl = 12000; // 12 seconds (Ethereum block time)
  }

  /**
   * Initialize the viem client with the Helios transport
   * Must be called after heliosClient.start()
   */
  init() {
    if (!this.client) {
      this.client = createPublicClient({
        chain: mainnet,
        transport: this.heliosClient.getTransport()
      });
    }
  }

  /**
   * Check if the resolver is ready (Helios is synced)
   */
  isReady() {
    return this.heliosClient.isReady();
  }

  /**
   * Wait for the resolver to be ready (Helios to sync)
   */
  async waitForReady() {
    await this.heliosClient.waitForSync();
    // Initialize client if not already done
    if (!this.client) {
      this.init();
    }
  }

  async resolveENS(domain) {
    // Check memory cache first
    const cached = this.memoryCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`Using in-memory cached CID for ${domain}: ${cached.cid} (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
      return cached.cid;
    }
    
    // Remove expired cache entry if present
    if (cached && cached.expiresAt <= Date.now()) {
      this.memoryCache.delete(domain);
    }
    
    try {
      // Wait for Helios to be synced before resolving
      if (!this.heliosClient.isReady()) {
        console.log('Waiting for Helios to sync...');
        await this.heliosClient.waitForSync();
        // Initialize client if not already done
        if (!this.client) {
          this.init();
        }
      }
      
      // Try to resolve from ENS
      const ipfsHash = await this._resolveFromENS(domain);
      
      // Store in memory cache with TTL
      this.memoryCache.set(domain, {
        cid: ipfsHash,
        expiresAt: Date.now() + this.cacheTtl
      });
      
      return ipfsHash;
    } catch (error) {
      // Error could mean: offline, domain doesn't exist, RPC down, timeout, etc.
      console.error(`ENS resolution failed for ${domain}:`, error);
      console.log('Attempting to use persistent cached CID...');
      
      const cachedCid = getLatestCid(domain);
      if (cachedCid) {
        console.log(`Using persistent cached CID for ${domain}: ${cachedCid}`);
        
        // Store in memory cache as well
        this.memoryCache.set(domain, {
          cid: cachedCid,
          expiresAt: Date.now() + this.cacheTtl
        });
        
        return cachedCid;
      }
      
      // No cache available, re-throw error
      throw new Error(`Cannot resolve ${domain}: ${error.message} (no cache available)`);
    }
  }

  async _resolveFromENS(domain) {
    // Ensure client is initialized
    if (!this.client) {
      throw new Error('ENS resolver not initialized. Call init() first.');
    }

    // Remove .eth suffix if present
    const cleanDomain = domain.replace(/\.eth$/, '');
    const fullDomain = cleanDomain + '.eth';
    
    console.log(`Resolving ENS domain: ${fullDomain}`);
    
    // Use the resolveEnsDomain function from @simplepage/common
    const { cid } = await resolveEnsDomain(this.client, fullDomain, this.universalResolver);
    console.log(`Resolved ENS domain: ${cid}`);
    
    if (!cid) {
      throw new Error(`No content hash found for ${fullDomain}`);
    }

    // resolveEnsDomain returns a CID instance, convert to string
    const ipfsHash = cid.toString();
    console.log(`Content hash for ${fullDomain}: ${ipfsHash}`);
    
    return ipfsHash;
  }

  async isENSName(name) {
    try {
      // Check if it's a valid ENS name format
      return name.includes('.eth') || name.match(/^[a-z0-9-]+$/);
    } catch (error) {
      return false;
    }
  }
}

export { ENSResolver };
