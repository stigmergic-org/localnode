import { CID } from 'multiformats/cid';
import { getAllCachedDomains } from './cache-api.js';
import { saveCidIfChanged } from './cache-manager.js';
import { createLogger } from './logger.js';

/**
 * AutoSeeding - Manages automatic updates for cached ENS domains
 */
export class AutoSeeding {
  constructor(ensResolver, ipfsManager, options = {}) {
    this.ensResolver = ensResolver;
    this.ipfsManager = ipfsManager;
    this.logger = createLogger('AutoSeeding');
    this.interval = null;
    this.intervalMs = (options.intervalMinutes || 10) * 60 * 1000;
  }

  /**
   * Start the auto-seeding update loop
   */
  start() {
    if (this.interval) {
      this.logger.warn('Auto-seeding already running');
      return;
    }
    
    this.logger.info(`Starting auto-seeding (every ${this.intervalMs / 60000} minutes)`);
    
    // Run immediately, then on interval
    this.checkUpdates();
    this.interval = setInterval(() => this.checkUpdates(), this.intervalMs);
  }

  /**
   * Stop the auto-seeding update loop
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.info('Auto-seeding stopped');
    }
  }

  /**
   * Check for updates on all auto-seeding domains
   */
  async checkUpdates() {
    try {
      this.logger.debug('Checking for updates');
      
      const domains = getAllCachedDomains();
      const autoSeedingDomains = domains.filter(d => d.autoSeeding);
      
      if (autoSeedingDomains.length === 0) {
        this.logger.debug('No domains to check');
        return;
      }
      
      this.logger.info(`Checking ${autoSeedingDomains.length} domains for updates`);
      
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
      
      // Check if CIDs are equal
      if (oldCidObj.equals(newCidObj)) {
        this.logger.debug(`${domain} is up to date (${newCid.substring(0, 20)}...)`);
        return;
      }
      
      this.logger.info(`${domain} has update: ${oldCid.substring(0, 20)}... → ${newCid.substring(0, 20)}...`);
      
      // Update the domain
      await this.updateDomain(domain, newCid);
      
    } catch (error) {
      this.logger.error(`Error checking ${cachedDomain.domain}`, error);
    }
  }

  /**
   * Update a domain with new CID
   */
  async updateDomain(domain, newCid) {
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
}

