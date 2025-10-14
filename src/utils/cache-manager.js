import fs from 'fs';
import path from 'path';
import { getCacheDir } from './config.js';
import { createLogger } from './logger.js';

/**
 * Get the cache directory for a specific domain
 * @param {string} domain - The ENS domain (e.g., 'dapprank.eth')
 * @returns {string} Path to the domain's cache directory
 */
export function getCacheDirForDomain(domain) {
  const cacheDir = getCacheDir();
  const domainDir = path.join(cacheDir, domain);
  
  if (!fs.existsSync(domainDir)) {
    fs.mkdirSync(domainDir, { recursive: true });
  }
  
  return domainDir;
}

/**
 * Get the latest cached CID for a domain
 * @param {string} domain - The ENS domain
 * @returns {string|null} The latest CID or null if no cache exists
 */
export function getLatestCid(domain) {
  const logger = createLogger('CacheManager');
  
  try {
    const domainDir = path.join(getCacheDir(), domain);
    
    if (!fs.existsSync(domainDir)) {
      return null;
    }
    
    const files = fs.readdirSync(domainDir)
      .filter(f => f.endsWith('.txt'))
      .sort()
      .reverse(); // Latest timestamp first
    
    if (files.length === 0) {
      return null;
    }
    
    const latestFile = path.join(domainDir, files[0]);
    const cid = fs.readFileSync(latestFile, 'utf8').trim();
    
    return cid;
  } catch (error) {
    logger.error(`Error reading cache for ${domain}`, error);
    return null;
  }
}

/**
 * Save CID to cache, but only if it's different from the latest cached version
 * @param {string} domain - The ENS domain
 * @param {string} cid - The IPFS CID to cache
 * @returns {Promise<boolean>} True if saved, false if unchanged or error
 */
export async function saveCidIfChanged(domain, cid) {
  const logger = createLogger('CacheManager');
  
  try {
    const latestCid = getLatestCid(domain);
    
    // Don't save if it's the same as latest
    if (latestCid === cid) {
      return false;
    }
    
    const domainDir = getCacheDirForDomain(domain);
    const timestamp = Date.now();
    const cacheFile = path.join(domainDir, `${timestamp}.txt`);
    
    fs.writeFileSync(cacheFile, cid, 'utf8');
    logger.info(`Cached new CID for ${domain}: ${cid}`);
    
    return true;
  } catch (error) {
    logger.error(`Error saving cache for ${domain}`, error);
    return false;
  }
}

/**
 * Clean up old cache versions, keeping only the latest N versions
 * @param {string} domain - The ENS domain
 * @param {number} keep - Number of versions to keep (default: 10)
 */
export function cleanupOldVersions(domain, keep = 10) {
  const logger = createLogger('CacheManager');
  
  try {
    const domainDir = path.join(getCacheDir(), domain);
    
    if (!fs.existsSync(domainDir)) {
      return;
    }
    
    const files = fs.readdirSync(domainDir)
      .filter(f => f.endsWith('.txt'))
      .sort()
      .reverse(); // Latest first
    
    // Delete files beyond the keep limit
    files.slice(keep).forEach(file => {
      const filePath = path.join(domainDir, file);
      fs.unlinkSync(filePath);
      logger.debug(`Cleaned up old cache: ${file}`);
    });
  } catch (error) {
    logger.error(`Error cleaning up cache for ${domain}`, error);
  }
}

