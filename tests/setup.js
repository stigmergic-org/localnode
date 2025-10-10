/**
 * Test Setup
 * 
 * This file handles test environment setup, including:
 * - SSL certificate handling for self-signed certs
 * - Environment variables
 * - Starting/stopping the test server
 */

import { startServer } from '../src/main/server.js';
import { loadConfig, getCertsDir } from '../src/utils/config.js';

// Disable SSL certificate validation for self-signed certificates in tests
// This is safe for testing against localhost
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let server = null;

// Global setup - runs once before all tests
export async function setup() {
  console.log('\n🚀 Starting LocalNode server for tests...');
  
  try {
    const config = loadConfig();
    
    server = await startServer({
      port: config.port,
      consensusRpc: config.consensusRpc,
      executionRpc: config.executionRpc,
      ipfsApiUrl: config.ipfsApiUrl,
      domain: config.domain,
      certDir: getCertsDir()
    });
    
    // Wait for Helios to sync
    console.log('⏳ Waiting for Helios to sync...');
    await server.heliosClient.waitForSync();
    
    console.log('✅ Server ready, starting tests\n');
  } catch (error) {
    console.error('❌ Failed to start test server:', error);
    throw error;
  }
}

// Global teardown - runs once after all tests
export async function teardown() {
  console.log('\n🛑 Stopping test server...');
  if (server) {
    await server.stop();
    server = null;
  }
  console.log('✅ Test server stopped\n');
}

