import fs from 'fs';
import path from 'path';
import { getCertsDir } from '../utils/config.js';
import { LocalCA } from '../certificates/local-ca.js';
import { createCertDialog } from './windows.js';

/**
 * Check if certificates need to be installed and handle installation
 * @returns {Promise<boolean>} True if certificates are ready
 */
export async function checkAndInstallCertificates() {
  const certDir = getCertsDir();
  const localCA = new LocalCA(certDir);
  const caCertPath = path.join(certDir, 'ca-cert.pem');

  // If CA certificate already exists and is installed, skip
  if (fs.existsSync(caCertPath)) {
    const isInstalled = await localCA.isCertificateInstalled();
    if (isInstalled) {
      console.log('Certificate is already installed in system keychain');
      return true;
    }
  }

  // Need to create or install certificates
  // Create CA first if it doesn't exist
  if (!fs.existsSync(caCertPath)) {
    console.log('Creating Certificate Authority...');
    await localCA.createCA();
  }

  // Show the certificate installation dialog
  console.log('Showing certificate installation dialog...');
  const result = await createCertDialog();

  if (result.skipped) {
    console.log('Certificate installation skipped by user');
    console.log('💡 Your browser will show security warnings until you install the certificate');
    return false;
  }

  if (result.success) {
    console.log('Certificate installed successfully');
    return true;
  } else {
    console.error('Certificate installation failed:', result.error);
    return false;
  }
}

