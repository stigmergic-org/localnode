/**
 * RPC Routes - Handles Ethereum JSON-RPC requests
 * Thin wrapper around the Helios client request method
 */

/**
 * Setup RPC routes for Ethereum JSON-RPC API
 * @param {Express} app - Express application instance
 * @param {HeliosClient} heliosClient - Helios client instance
 */
export function setupRpcRoutes(app, heliosClient) {
  // Health check endpoint (non-standard, but useful for monitoring)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      helios: {
        ready: heliosClient.isReady(),
        started: heliosClient.isStarted
      }
    });
  });

  // Main JSON-RPC endpoint (POST) - handles both single and batch requests
  app.post('/', async (req, res) => {
    // Handle batch requests (array of requests) - part of JSON-RPC 2.0 spec
    if (Array.isArray(req.body)) {
      try {
        if (!heliosClient.isReady()) {
          return res.status(503).json(
            req.body.map(item => ({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: heliosClient.syncPromise 
                  ? 'Helios client is syncing. Please wait...'
                  : 'Helios client not ready'
              },
              id: item.id || null
            }))
          );
        }

        console.log(`[RPC] Batch request with ${req.body.length} calls`);

        const results = await Promise.all(
          req.body.map(async (request) => {
            try {
              const { method, params, id, jsonrpc } = request;
              
              if (!method) {
                return {
                  jsonrpc: '2.0',
                  error: {
                    code: -32600,
                    message: 'Invalid Request: method is required'
                  },
                  id: id || null
                };
              }

              const result = await heliosClient.request(method, params || []);
              
              return {
                jsonrpc: jsonrpc || '2.0',
                result,
                id: id || null
              };
            } catch (error) {
              return {
                jsonrpc: '2.0',
                error: {
                  code: -32603,
                  message: error.message || 'Internal error'
                },
                id: request.id || null
              };
            }
          })
        );

        return res.json(results);
      } catch (error) {
        console.error('[RPC] Batch error:', error.message);
        return res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Batch request failed'
          },
          id: null
        });
      }
    }

    // Handle single request
    try {
      // Check if Helios is ready
      if (!heliosClient.isReady()) {
        // If not ready, check if it's starting
        if (heliosClient.syncPromise) {
          return res.status(503).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Helios client is syncing. Please wait...'
            },
            id: req.body?.id || null
          });
        }
        
        return res.status(503).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Helios client not ready'
          },
          id: req.body?.id || null
        });
      }

      const { method, params, id, jsonrpc } = req.body;

      // Validate JSON-RPC request
      if (!method) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: method is required'
          },
          id: id || null
        });
      }

      console.log(`[RPC] ${method}`, params ? `(${JSON.stringify(params).slice(0, 100)}...)` : '');

      // Forward request to Helios client
      const result = await heliosClient.request(method, params || []);

      // Return JSON-RPC response
      res.json({
        jsonrpc: jsonrpc || '2.0',
        result,
        id: id || null
      });

    } catch (error) {
      console.error('[RPC] Error:', error.message);
      
      // Return JSON-RPC error response
      res.status(200).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error.message || 'Internal error'
        },
        id: req.body?.id || null
      });
    }
  });

  // GET endpoint for simple methods (useful for debugging)
  app.get('/', (req, res) => {
    res.send(`
      <html>
        <head><title>Ethereum RPC Endpoint</title></head>
        <body>
          <h1>Ethereum JSON-RPC Endpoint</h1>
          <p>This endpoint provides Ethereum JSON-RPC access via Helios light client.</p>
          <p>Status: ${heliosClient.isReady() ? '✅ Ready' : '⏳ Syncing...'}</p>
          <h2>Usage</h2>
          <p>Send POST requests with JSON-RPC 2.0 format:</p>
          <pre>{
  "jsonrpc": "2.0",
  "method": "eth_blockNumber",
  "params": [],
  "id": 1
}</pre>
          <h2>Available Endpoint</h2>
          <ul>
            <li>https://ethereum.node.localhost</li>
          </ul>
          <h2>Health Check</h2>
          <p>GET /health for status information</p>
        </body>
      </html>
    `);
  });
}

