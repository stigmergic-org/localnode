import fs from 'fs';
import path from 'path';
import { getCertsDir } from '../utils/config.js';
import { OpenSSLCA } from '../certificates/openssl-ca.js';
import { createCertDialog } from './windows.js';
import { createLogger } from '../utils/logger.js';

/**
 * Check if certificates need to be installed and handle installation
 * @returns {Promise<boolean>} True if certificates are ready
 */
export async function checkAndInstallCertificates() {
  const logger = createLogger('CertManager');
  const certDir = getCertsDir();
  const opensslCA = new OpenSSLCA(certDir);
  const rootCertPath = path.join(certDir, 'root-ca-cert.pem');

  // If root CA certificate already exists and is installed, skip
  if (fs.existsSync(rootCertPath)) {
    const isInstalled = await opensslCA.isCertificateInstalled();
    if (isInstalled) {
      logger.info('Root CA is already installed in system keychain');
      return true;
    }
  }

  // Need to create or install certificates
  // Create CA first if it doesn't exist
  if (!fs.existsSync(rootCertPath)) {
    logger.info('Creating Certificate Authority hierarchy');
    await opensslCA.initialize(true); // Skip install prompt, we'll handle it ourselves
  }

  // Show the certificate installation dialog
  logger.info('Showing certificate installation dialog');
  const result = await createCertDialog();

  if (result.skipped) {
    logger.info('Certificate installation skipped by user');
    logger.warn('💡 Your browser will show security warnings until you install the certificate');
    return false;
  }

  if (result.success) {
    logger.info('Root CA installed successfully');
    return true;
  } else {
    logger.error('Certificate installation failed', result.error);
    return false;
  }
}

