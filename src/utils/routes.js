import http from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { saveCidIfChanged } from './cache-manager.js';
import { pinCid, pinPath } from './pin-manager.js';

/**
 * Normalize gateway host - replace IP addresses with localhost for subdomain compatibility
 * @param {string} gatewayUrl - The gateway URL
 * @returns {string} Normalized host suitable for subdomain usage
 */
function normalizeGatewayHost(gatewayUrl) {
  let host = gatewayUrl.replace(/^https?:\/\//, '');
  // Replace common IP addresses with localhost for subdomain DNS compatibility
  host = host.replace(/^127\.0\.0\.1/, 'localhost');
  host = host.replace(/^0\.0\.0\.0/, 'localhost');
  return host;
}

function setupRoutes(app, ensResolver, options) {
  // Cache for proxy instances - reuse proxies for the same IPFS hash
  const proxyCache = new Map();
  // Main route handler for ENS domains
  app.get('*', async (req, res) => {
    const host = req.headers.host;
    
    // Extract ENS domain from subdomain (declare outside try/catch so it's available in error handler)
    const ensDomain = extractENSDomain(host, options.domain);
    if (!ensDomain) {
      return res.status(404).send('Not a valid ENS domain');
    }

    try {
      console.log(`Processing request for ENS domain: ${ensDomain}`);
      
      // Resolve ENS to IPFS hash (will use cache on error)
      const ipfsHash = await ensResolver.resolveENS(ensDomain);
      console.log(`Resolved to IPFS hash: ${ipfsHash}`);
      
      // Proxy the request to the IPFS gateway
      const gatewayHost = normalizeGatewayHost(options.ipfsGateway);
      const ipfsBaseUrl = `http://${ipfsHash}.ipfs.${gatewayHost}`;
      console.log(`Proxying to IPFS gateway: ${ipfsBaseUrl}${req.path}`);
      
      // 🔥 ASYNC POST-PROCESSING (fire and forget - don't block the request)
      // Save CID to cache if it changed
      saveCidIfChanged(ensDomain, ipfsHash).catch(err => 
        console.error('Cache save error:', err.message)
      );
      
      // Pin the root CID
      pinCid(ipfsHash).catch(err => 
        console.error('Pin root error:', err.message)
      );
      
      // Pin the requested path (if not root)
      if (req.path !== '/') {
        pinPath(ipfsHash, req.path).catch(err => 
          console.error('Pin path error:', err.message)
        );
      }
      
      // Get or create proxy middleware for this IPFS hash (reuse existing proxies)
      let proxy = proxyCache.get(ipfsHash);
      
      if (!proxy) {
        console.log(`[HPM] Creating new proxy for: ${ipfsBaseUrl}`);
        
        // Create custom agent that resolves *.ipfs.localhost to 127.0.0.1 without DNS
        class LocalhostAgent extends http.Agent {
          createConnection(options, callback) {
            // Override host resolution for *.ipfs.localhost domains
            if (options.host && (options.host.includes('.ipfs.localhost') || options.host.endsWith('.ipfs.localhost'))) {
              console.log(`[Agent] Redirecting ${options.host} to 127.0.0.1:${options.port}`);
              options.host = '127.0.0.1';
            }
            return super.createConnection(options, callback);
          }
        }
        
        proxy = createProxyMiddleware({
          target: ipfsBaseUrl,
          changeOrigin: true,
          agent: new LocalhostAgent(),
          onProxyRes: (proxyRes, req, res) => {
            // Prevent caching of HTML files (index files) to ensure fresh content on reload
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('text/html') || req.path === '/' || req.path.endsWith('/')) {
              proxyRes.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
              proxyRes.headers['Pragma'] = 'no-cache';
              proxyRes.headers['Expires'] = '0';
            }
          },
          onError: (err, req, res) => {
            console.error('Proxy error:', err.message);
            res.status(500).send(`
              <html>
                <head><title>IPFS Gateway Error</title></head>
                <body>
                  <h1>IPFS Gateway Error</h1>
                  <p>Could not fetch content from IPFS gateway: ${err.message}</p>
                  <p>Please check that your IPFS gateway is running at ${options.ipfsGateway}</p>
                </body>
              </html>
            `);
          }
        });
        proxyCache.set(ipfsHash, proxy);
      }
      
      // Execute the proxy as middleware
      proxy(req, res, (err) => {
        if (err) {
          console.error('Proxy execution error:', err.message);
          res.status(500).send(`
            <html>
              <head><title>Proxy Error</title></head>
              <body>
                <h1>Proxy Error</h1>
                <p>Error executing proxy: ${err.message}</p>
              </body>
            </html>
          `);
        }
      });
      
    } catch (error) {
      console.error('Error processing request:', error.message);
      
      if (error.message.includes('No resolver found') || error.message.includes('No content hash')) {
        res.status(404).send(`
          <html>
            <head><title>ENS Domain Not Found</title></head>
            <body>
              <h1>ENS Domain Not Found</h1>
              <p>The ENS domain "${ensDomain}" could not be resolved.</p>
              <p>This could mean:</p>
              <ul>
                <li>The domain doesn't exist</li>
                <li>The domain doesn't have a content hash set</li>
                <li>There's an issue with the Ethereum RPC connection</li>
              </ul>
            </body>
          </html>
        `);
      } else {
        res.status(500).send(`
          <html>
            <head><title>Server Error</title></head>
            <body>
              <h1>Server Error</h1>
              <p>An unexpected error occurred: ${error.message}</p>
            </body>
          </html>
        `);
      }
    }
  });
}

function extractENSDomain(host, domainSuffix) {
  // Extract ENS domain from subdomain like "vitalik.eth.localhost" or "test.simplepage.eth.localhost"
  const pattern = new RegExp(`^(.+)\\.eth\\.${domainSuffix.replace('.', '\\.')}$`);
  const match = host.match(pattern);
  
  if (match) {
    return match[1] + '.eth';
  }
  
  return null;
}

export { setupRoutes };