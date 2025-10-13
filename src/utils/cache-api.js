import fs from 'fs';
import path from 'path';
import { getCacheDir } from './config.js';
import { getLatestCid } from './cache-manager.js';
import { toString } from 'uint8arrays';

/**
 * Cache API utilities for the node.localhost management interface
 */

/**
 * Get all cached domains with just basic info (fast)
 * @returns {Promise<Array>} Array of domain objects with domain, cid, lastCached
 */
export function getAllCachedDomains() {
  try {
    const cacheDir = getCacheDir();
    
    if (!fs.existsSync(cacheDir)) {
      return [];
    }
    
    const domains = [];
    const domainDirs = fs.readdirSync(cacheDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const domain of domainDirs) {
      try {
        const cid = getLatestCid(domain);
        if (!cid) continue;
        
        // Get cache timestamp (latest file)
        const domainDir = path.join(cacheDir, domain);
        const cacheFiles = fs.readdirSync(domainDir)
          .filter(f => f.endsWith('.txt'))
          .sort()
          .reverse();
        
        const lastCached = cacheFiles.length > 0 
          ? new Date(parseInt(cacheFiles[0].replace('.txt', '')))
          : null;
        
        domains.push({
          domain,
          cid,
          lastCached: lastCached ? lastCached.toISOString() : null
        });
      } catch (error) {
        console.error(`Error processing domain ${domain}:`, error.message);
      }
    }
    
    return domains.sort((a, b) => a.domain.localeCompare(b.domain));
  } catch (error) {
    console.error('Error getting cached domains:', error);
    throw error;
  }
}

/**
 * Get favicon for a specific domain
 * @param {string} domain - The domain name
 * @param {IPFSManager} ipfsManager - The IPFS manager instance
 * @returns {Promise<string|null>} Base64 encoded favicon or null
 */
export async function getDomainFavicon(domain, ipfsManager) {
  try {
    const cid = getLatestCid(domain);
    if (!cid) {
      return null;
    }
    
    return await getFaviconFromCache(domain, cid, ipfsManager);
  } catch (error) {
    console.error(`Error getting favicon for ${domain}:`, error.message);
    return null;
  }
}

/**
 * Get sizes for a specific domain
 * @param {string} domain - The domain name
 * @param {IPFSManager} ipfsManager - The IPFS manager instance
 * @returns {Promise<{totalSize: string, localSize: string}>}
 */
export async function getDomainSizes(domain, ipfsManager) {
  try {
    const cid = getLatestCid(domain);
    if (!cid) {
      return { totalSize: 'Unknown', localSize: 'Unknown' };
    }
    
    return await getCidSizes(cid, ipfsManager);
  } catch (error) {
    console.error(`Error getting sizes for ${domain}:`, error.message);
    return { totalSize: 'Unknown', localSize: 'Unknown' };
  }
}


/**
 * Clear cache for a specific domain
 * @param {string} domain - The domain to clear cache for
 * @param {IPFSManager} ipfsManager - The IPFS manager instance (optional)
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clearDomainCache(domain, ipfsManager = null) {
  try {
    const cacheDir = getCacheDir();
    const domainDir = path.join(cacheDir, domain);
    
    if (!fs.existsSync(domainDir)) {
      return false; // Nothing to clear
    }
    
    // Get all CIDs from cache files before clearing
    const cids = new Set();
    const files = fs.readdirSync(domainDir);
    for (const file of files) {
      if (file.endsWith('.txt')) {
        try {
          const cidContent = fs.readFileSync(path.join(domainDir, file), 'utf8').trim();
          if (cidContent) {
            cids.add(cidContent);
          }
        } catch (error) {
          console.warn(`Could not read CID from ${file}:`, error.message);
        }
      }
    }
    
    // Remove all cache files for this domain
    for (const file of files) {
      fs.unlinkSync(path.join(domainDir, file));
    }
    
    // Remove the domain directory
    fs.rmdirSync(domainDir);
    
    console.log(`Cleared cache for domain: ${domain} (${cids.size} CIDs)`);
    
    // Remove all CIDs from MFS if we have IPFS manager
    if (cids.size > 0 && ipfsManager) {
      const client = ipfsManager.getClient();
      for (const cid of cids) {
        try {
          const mfsPath = `/localnode-cache/${cid}`;
          await client.files.rm(mfsPath, { recursive: true });
          console.log(`Removed ${cid} from MFS cache`);
        } catch (error) {
          // Log but don't fail if MFS removal fails (might not exist)
          console.warn(`Could not remove ${cid} from MFS: ${error.message}`);
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Error clearing cache for ${domain}:`, error.message);
    throw error;
  }
}

/**
 * Get both total and local sizes for a CID using MFS stat
 * @param {string} cid - The IPFS CID
 * @param {IPFSManager} ipfsManager - The IPFS manager instance
 * @returns {Promise<{totalSize: string, localSize: string}>}
 */
export async function getCidSizes(cid, ipfsManager) {
  try {
    const client = ipfsManager.getClient();
    const mfsPath = `/localnode-cache/${cid}`;
    
    // Use MFS stat with --with-local to get both sizes in one call
    const stat = await client.files.stat(mfsPath, { withLocal: true });
    
    // Extract sizes from stat result
    // stat.cumulativeSize is the total size
    // stat.sizeLocal is the locally stored size when withLocal is true
    const totalSize = stat.cumulativeSize || stat.size || 0;
    const localSize = stat.sizeLocal || 0;
    
    return {
      totalSize: formatBytes(totalSize),
      localSize: formatBytes(localSize)
    };
  } catch (error) {
    console.warn(`[getCidSizes] Error:`, error.message);
    return { totalSize: 'Unknown', localSize: 'Unknown' };
  }
}

/**
 * Extract favicon from cached domain's index.html
 * @param {string} domain - The domain name
 * @param {string} cid - The IPFS CID for the domain
 * @param {IPFSManager} ipfsManager - The IPFS manager instance
 * @returns {Promise<string|null>} Base64 encoded favicon or null
 */
export async function getFaviconFromCache(domain, cid, ipfsManager) {
  try {
    const client = ipfsManager.getClient();
    
    // Try to get index.html from the CID
    const indexPath = `${cid}/index.html`;
    
    let htmlContent = '';
    let faviconPath = null;
    
    // Stream the HTML and abort once we find the favicon tag
    try {
      const stream = client.cat(indexPath);
      
      for await (const chunk of stream) {
        htmlContent += toString(chunk);
        
        // Check if we have enough content to find the favicon
        // Look for </head> or enough content (first 50KB should be enough for <head>)
        if (htmlContent.includes('</head>') || htmlContent.length > 50000) {
          // Try to find favicon in what we have so far
          const faviconMatch = htmlContent.match(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
          if (faviconMatch) {
            faviconPath = faviconMatch[1];
            break; // Found it! Stop streaming
          }
          
          // If we've seen </head> and no favicon, give up
          if (htmlContent.includes('</head>')) {
            break;
          }
        }
      }
    } catch (error) {
      console.warn(`Could not stream HTML for ${domain}:`, error.message);
      return null;
    }
    
    if (!faviconPath) {
      return null;
    }
    
    // Handle different path formats
    let faviconUrl;
    if (faviconPath.startsWith('http')) {
      // External URL - return as is
      return faviconPath;
    } else if (faviconPath.startsWith('/')) {
      // Absolute path from root
      faviconUrl = `https://${domain}.localhost${faviconPath}`;
    } else {
      // Relative path
      faviconUrl = `https://${domain}.localhost/${faviconPath}`;
    }
    
    return faviconUrl;
  } catch (error) {
    console.error(`Error getting favicon for ${domain}:`, error.message);
    return null;
  }
}

/**
 * Format bytes into human readable format
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
