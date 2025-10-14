import fs from 'fs';
import path from 'path';
import { LocalCA } from './local-ca.js';
import { createLogger } from '../utils/logger.js';

async function generateCertificates(certDir, domain) {
  const logger = createLogger('Certificates');
  
  // Create certificates directory if it doesn't exist
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  // Check if certificates already exist
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    logger.info('SSL certificates already exist');
    return;
  }

  logger.info('Generating locally-trusted SSL certificates using local CA');
  
  try {
    const localCA = new LocalCA(certDir);
    
    // Initialize CA (create if doesn't exist)
    // Skip install prompt in Electron mode - it's handled separately in main.js
    const skipInstallPrompt = !!process.versions.electron;
    await localCA.initialize(skipInstallPrompt);
    
    // Generate server certificate signed by the local CA
    await localCA.generateServerCertificate(domain);
    
    console.log('✅ Successfully generated locally-trusted SSL certificates using local CA');
    console.log('These certificates should be automatically trusted by your browser');
    
  } catch (error) {
    throw new Error(`Failed to generate SSL certificates: ${error.message}`);
  }
}

export { generateCertificates };
