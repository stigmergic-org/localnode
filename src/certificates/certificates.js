import fs from 'fs';
import path from 'path';
import { OpenSSLCA } from './openssl-ca.js';
import { createLogger } from '../utils/logger.js';

async function generateCertificates(certDir, domain) {
  const logger = createLogger('Certificates');
  
  // Create certificates directory if it doesn't exist
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  logger.info('Initializing OpenSSL-based certificate system');
  
  try {
    const opensslCA = new OpenSSLCA(certDir);
    
    // Initialize CA (creates root CA, intermediate CA, and all certificates on first run)
    // Skip install prompt in Electron mode - it's handled separately in main.js
    const skipInstallPrompt = !!process.versions.electron;
    await opensslCA.initialize(skipInstallPrompt);
    
    // Verify certificates were created
    const serverKeyPath = path.join(certDir, 'server-key.pem');
    const ethCertPath = path.join(certDir, 'eth-cert.pem');
    
    if (!fs.existsSync(serverKeyPath)) {
      throw new Error(`Server key was not created at: ${serverKeyPath}`);
    }
    if (!fs.existsSync(ethCertPath)) {
      throw new Error(`Eth cert was not created at: ${ethCertPath}`);
    }
    
    console.log('✅ Successfully generated locally-trusted SSL certificates using OpenSSL');
    console.log('   📜 Certificate Chain Architecture:');
    console.log('      ├─ *.eth.localhost → Root CA (2-level, one-time signing)');
    console.log('      ├─ *.simplepage.eth.localhost → Intermediate CA → Root CA (3-level, JIT)');
    console.log('      └─ *.node.localhost → Root CA (2-level, one-time signing)');
    console.log('   📁 Certificate Files:');
    console.log('      ├─ server-key.pem (shared by all leaf certs)');
    console.log('      ├─ eth-cert.pem');
    console.log('      ├─ node-cert.pem');
    console.log('      ├─ wildcard-<name>-eth-cert.pem (JIT generated)');
    console.log('      ├─ intermediate-ca-key.pem + intermediate-ca-cert.pem');
    console.log('      └─ root-ca-cert.pem (install this in system keychain)');
    
    // Return the CA instance for SNI callback usage
    return opensslCA;
    
  } catch (error) {
    throw new Error(`Failed to generate SSL certificates: ${error.message}`);
  }
}

export { generateCertificates };
