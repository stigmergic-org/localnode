import fs from 'fs';
import path from 'path';
import { getCacheDir } from './config.js';
import { getLatestCid } from './cache-manager.js';
import all from 'it-all';
import { concat, toString } from 'uint8arrays';
import { CID } from 'multiformats/cid';

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
 * Get all locally stored CIDs (cached globally)
 * @param {IPFSManager} ipfsManager - The IPFS manager instance
 * @returns {Promise<Set<string>>} Set of locally stored CIDs
 */
let localRefsCache = null;
let localRefsCacheTime = 0;
const LOCAL_REFS_TTL = 30000; // 30 seconds

async function getLocalRefs(ipfsManager) {
  const now = Date.now();
  
  // Return cached refs if still valid
  if (localRefsCache && (now - localRefsCacheTime) < LOCAL_REFS_TTL) {
    console.log(`[getLocalRefs] Using CACHED refs (${localRefsCache.size} CIDs, age: ${Math.round((now - localRefsCacheTime) / 1000)}s)`);
    return localRefsCache;
  }
  
  const refsStart = Date.now();
  console.log('[getLocalRefs] Fetching fresh local refs from IPFS...');
  
  try {
    const client = ipfsManager.getClient();
    const refs = await all(client.refs.local());
    const refsTime = Date.now() - refsStart;
    
    // Extract CIDs from refs
    const cidSet = new Set(refs.map(item => {
      return item.ref || item.cid?.toString() || item.toString();
    }));
    
    // Log if count changed significantly
    if (localRefsCache && cidSet.size !== localRefsCache.size) {
      console.log(`[getLocalRefs] ⚠️  CID count CHANGED: ${localRefsCache.size} → ${cidSet.size} (Δ ${cidSet.size - localRefsCache.size})`);
    }
    
    // Update cache
    localRefsCache = cidSet;
    localRefsCacheTime = now;
    
    console.log(`[getLocalRefs] Fetched ${cidSet.size} CIDs in ${refsTime}ms`);
    return cidSet;
  } catch (error) {
    console.warn('[getLocalRefs] Error:', error.message);
    return localRefsCache || new Set();
  }
}

/**
 * Clear cache for a specific domain
 * @param {string} domain - The domain to clear cache for
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clearDomainCache(domain) {
  try {
    const cacheDir = getCacheDir();
    const domainDir = path.join(cacheDir, domain);
    
    if (!fs.existsSync(domainDir)) {
      return false; // Nothing to clear
    }
    
    // Remove all cache files for this domain
    const files = fs.readdirSync(domainDir);
    for (const file of files) {
      fs.unlinkSync(path.join(domainDir, file));
    }
    
    // Remove the domain directory
    fs.rmdirSync(domainDir);
    
    console.log(`Cleared cache for domain: ${domain}`);
    return true;
  } catch (error) {
    console.error(`Error clearing cache for ${domain}:`, error.message);
    throw error;
  }
}

/**
 * Get both total and local sizes for a CID
 * @param {string} cid - The IPFS CID
 * @param {IPFSManager} ipfsManager - The IPFS manager instance
 * @returns {Promise<{totalSize: string, localSize: string}>}
 */
export async function getCidSizes(cid, ipfsManager) {
  const fnStart = Date.now();
  console.log(`\n[getCidSizes] Starting for CID: ${cid.substring(0, 20)}...`);
  
  try {
    const client = ipfsManager.getClient();
    
    // Get all local refs (cached globally)
    const refsStart = Date.now();
    const localRefs = await getLocalRefs(ipfsManager);
    const refsTime = Date.now() - refsStart;
    console.log(`[getCidSizes]   getLocalRefs: ${refsTime}ms (${localRefs.size} CIDs)`);
    
    // Parse CID string to CID object
    const cidObj = CID.parse(cid);
    
    // Get the root DAG node without fetching sub-blocks
    const dagStart = Date.now();
    const result = await client.dag.get(cidObj);
    const dagTime = Date.now() - dagStart;
    console.log(`[getCidSizes]   dag.get: ${dagTime}ms`);
    
    const node = result.value;
    
    // Extract links from the DAG node
    const links = node.Links || [];
    console.log(`[getCidSizes]   Links found: ${links.length}`);
    
    // Calculate both sizes in one reduce
    const { totalSize, localSize } = links.reduce((acc, link) => {
      // Use Tsize (total size including all sub-blocks)
      const linkSize = link.Tsize || link.Size || 0;
      const linkCid = link.Hash?.toString() || link.Cid?.toString();
      
      // Add to total size
      acc.totalSize += linkSize;
      
      // Add to local size if we have this CID locally
      if (linkCid && localRefs.has(linkCid)) {
        acc.localSize += linkSize;
      }
      
      return acc;
    }, { totalSize: 0, localSize: 0 });
    
    const fnTime = Date.now() - fnStart;
    console.log(`[getCidSizes]   Result: Total ${formatBytes(totalSize)}, Local ${formatBytes(localSize)}`);
    console.log(`[getCidSizes]   TOTAL TIME: ${fnTime}ms\n`);
    
    return {
      totalSize: formatBytes(totalSize),
      localSize: formatBytes(localSize)
    };
  } catch (error) {
    const fnTime = Date.now() - fnStart;
    console.warn(`[getCidSizes]   Error after ${fnTime}ms:`, error.message);
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
