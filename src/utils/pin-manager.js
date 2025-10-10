import { getConfigValue } from './config.js';

// In-memory cache of pinned CIDs to avoid redundant API calls
const pinnedCids = new Set();

/**
 * Get the IPFS API URL from config
 * @returns {string} IPFS API URL
 */
function getIpfsApiUrl() {
  return getConfigValue('ipfsApiUrl')
}

/**
 * Pin a CID in IPFS (non-recursive)
 * @param {string} cid - The IPFS CID to pin
 * @returns {Promise<boolean>} True if pinned, false otherwise
 */
export async function pinCid(cid) {
  // Check in-memory cache first
  if (pinnedCids.has(cid)) {
    return true;
  }
  
  try {
    const apiUrl = getIpfsApiUrl();
    const url = `${apiUrl}/api/v0/pin/add?arg=${cid}&recursive=false`;
    
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (response.ok) {
      pinnedCids.add(cid);
      console.log(`Pinned CID: ${cid}`);
      return true;
    } else {
      console.warn(`Failed to pin ${cid}: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    // IPFS daemon might not be running - that's ok, don't crash
    console.warn(`Could not pin ${cid}:`, error.message);
    return false;
  }
}

/**
 * Pin a specific path within an IPFS CID
 * @param {string} rootCid - The root IPFS CID
 * @param {string} path - The path to pin (e.g., '/images/logo.png')
 * @returns {Promise<boolean>} True if pinned, false otherwise
 */
export async function pinPath(rootCid, path) {
  const apiUrl = getIpfsApiUrl();
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Build array of all paths to pin (root + all parent directories + final path)
  const pathsToPinPaths = [`/ipfs/${rootCid}`];
  
  if (cleanPath) {
    const segments = cleanPath.split('/').filter(Boolean);
    let currentPath = `/ipfs/${rootCid}`;
    
    for (const segment of segments) {
      currentPath += `/${segment}`;
      pathsToPinPaths.push(currentPath);
    }
  }
  
  // Pin each path in sequence (root first, then each parent, then final path)
  let allSucceeded = true;
  
  for (const ipfsPath of pathsToPinPaths) {
    // Create cache key from the path
    const cacheKey = ipfsPath.replace(`/ipfs/${rootCid}`, rootCid);
    
    // Skip if already pinned
    if (pinnedCids.has(cacheKey)) {
      continue;
    }
    
    try {
      const url = `${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(ipfsPath)}&recursive=false`;
      
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      if (response.ok) {
        pinnedCids.add(cacheKey);
        console.log(`Pinned path: ${ipfsPath}`);
      } else {
        console.warn(`Failed to pin path ${ipfsPath}: ${response.status} ${response.statusText}`);
        allSucceeded = false;
      }
    } catch (error) {
      console.warn(`Could not pin path ${ipfsPath}:`, error.message);
      allSucceeded = false;
    }
  }
  
  return allSucceeded;
}

/**
 * Check if a CID is pinned (in-memory check only)
 * @param {string} cid - The CID to check
 * @returns {boolean} True if marked as pinned in memory
 */
export function isPinned(cid) {
  return pinnedCids.has(cid);
}

