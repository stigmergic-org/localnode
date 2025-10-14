import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import forge from 'node-forge';
import sudo from '@expo/sudo-prompt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const sudoExec = promisify(sudo.exec);

class PlatformInstaller {
  async installCA(caCertPath) {
    throw new Error('installCA must be implemented by subclass');
  }

  async isCAInstalled(caCertPath) {
    throw new Error('isCAInstalled must be implemented by subclass');
  }

  getManualInstructions(caCertPath) {
    throw new Error('getManualInstructions must be implemented by subclass');
  }
}

class MacOSInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    const logger = createLogger('MacOSInstaller');
    try {
      logger.info('Installing CA to macOS keychain');
      
      // Install to the user's login keychain - no sudo/admin privileges required!
      // This is simpler and works perfectly for the current user
      const homeDir = process.env.HOME;
      const loginKeychain = `${homeDir}/Library/Keychains/login.keychain-db`;
      
      await execAsync(`/usr/bin/security add-trusted-cert -r trustRoot -k "${loginKeychain}" "${caCertPath}"`);
      
      logger.info('Certificate installed and trusted successfully');
      return true;
    } catch (error) {
      logger.warn('Failed to install CA to macOS keychain', error);
      return false;
    }
  }

  async isCAInstalled(caCertPath) {
    try {
      // Read the local CA certificate file
      if (!fs.existsSync(caCertPath)) {
        return false;
      }
      
      const localCertPem = fs.readFileSync(caCertPath, 'utf8');
      const localCert = forge.pki.certificateFromPem(localCertPem);

      // Calculate SHA-1 fingerprint (macOS security command uses SHA-1 as unique ID)
      const sha1Hash = forge.md.sha1.create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(localCert)).getBytes())
        .digest()
        .toHex()
        .toUpperCase();

      // Search for the certificate by its unique SHA-1 hash in the login keychain
      // -a shows all certificates, -Z shows SHA-1 hash, then we grep for our specific hash
      const homeDir = process.env.HOME;
      const loginKeychain = `${homeDir}/Library/Keychains/login.keychain-db`;
      const { stdout } = await execAsync(
        `security find-certificate -a -Z "${loginKeychain}" 2>/dev/null | grep -A 1 "SHA-1 hash:" | grep "${sha1Hash}"`
      );
      
      // If we found the certificate, verify it's actually trusted as a root CA
      if (stdout.trim().length > 0) {
        // Now check if this certificate is trusted
        // We do this by checking the trust settings for SSL
        try {
          const trustResult = await execAsync(
            `security verify-cert -c "${caCertPath}" -p ssl 2>&1`
          );
          // If verify-cert succeeds (exit code 0), the cert is trusted
          return true;
        } catch (trustError) {
          // If verify-cert fails, the cert exists but is not trusted
          logger.debug('Certificate exists in keychain but is not trusted as a root CA');
          return false;
        }
      }
      
      return false;
    } catch (error) {
      // If the command fails, the certificate is not installed
      return false;
    }
  }

  getManualInstructions(caCertPath) {
    const homeDir = process.env.HOME;
    const loginKeychain = `${homeDir}/Library/Keychains/login.keychain-db`;
    
    return {
      title: 'macOS:',
      instructions: [
        `security add-trusted-cert -r trustAsRoot -k "${loginKeychain}" "${caCertPath}"`,
        '',
        'Or double-click the certificate file and add it to your login keychain with full trust.'
      ]
    };
  }
}

class WindowsInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    const logger = createLogger('WindowsInstaller');
    try {
      logger.info('Installing CA to Windows certificate store');
      
      const options = {
        name: 'Local Node',
      };
      
      const command = `certutil -addstore -enterprise Root "${caCertPath}"`;
      
      await sudoExec(command, options);
      logger.info('CA installed to Windows certificate store successfully');
      return true;
    } catch (error) {
      logger.warn('Failed to install CA to Windows certificate store', error);
      return false;
    }
  }

  async isCAInstalled(caCertPath) {
    try {
      // Read the local CA certificate file
      if (!fs.existsSync(caCertPath)) {
        return false;
      }
      
      const localCertPem = fs.readFileSync(caCertPath, 'utf8');
      const localCert = forge.pki.certificateFromPem(localCertPem);

      // Calculate SHA-1 fingerprint
      const sha1Hash = forge.md.sha1.create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(localCert)).getBytes())
        .digest()
        .toHex()
        .toUpperCase();

      // Check if certificate exists in Windows cert store
      // certutil -verifystore Root returns all certs; we look for our thumbprint
      const { stdout } = await execAsync(
        `certutil -verifystore Root 2>nul | findstr /i "${sha1Hash}"`
      );
      
      return stdout.trim().length > 0;
    } catch (error) {
      // If the command fails, the certificate is not installed
      return false;
    }
  }

  getManualInstructions(caCertPath) {
    return {
      title: 'Windows:',
      instructions: [
        '1. Double-click the certificate file',
        '2. Click "Install Certificate..."',
        '3. Choose "Local Machine" → "Place all certificates in the following store"',
        '4. Browse → "Trusted Root Certification Authorities" → OK'
      ]
    };
  }
}

class LinuxInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    const logger = createLogger('LinuxInstaller');
    try {
      logger.info('Installing CA to Linux trust store');
      
      // Calculate SHA-1 hash to include in filename
      const localCertPem = fs.readFileSync(caCertPath, 'utf8');
      const localCert = forge.pki.certificateFromPem(localCertPem);
      const sha1Hash = forge.md.sha1.create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(localCert)).getBytes())
        .digest()
        .toHex()
        .toLowerCase();

      const caDir = '/usr/local/share/ca-certificates';
      // Include hash in filename to make it unique to this specific certificate
      const caFile = path.join(caDir, `localnode-ca-${sha1Hash}.crt`);
      
      const options = {
        name: 'Local Node',
      };
      
      // Remove any old LocalNode CA certificates first (they'll have different hashes)
      const cleanupCommand = `rm -f ${caDir}/localnode-ca-*.crt 2>/dev/null || true`;
      
      // Copy the new certificate and update trust store in one sudo session
      const command = `${cleanupCommand} && cp "${caCertPath}" "${caFile}" && update-ca-certificates`;
      await sudoExec(command, options);
      
      logger.info('CA installed to Linux trust store successfully');
      return true;
    } catch (error) {
      logger.warn('Failed to install CA to Linux trust store', error);
      return false;
    }
  }

  async isCAInstalled(caCertPath) {
    try {
      // Read the local certificate to get its hash
      if (!fs.existsSync(caCertPath)) {
        return false;
      }

      const localCertPem = fs.readFileSync(caCertPath, 'utf8');
      const localCert = forge.pki.certificateFromPem(localCertPem);
      const sha1Hash = forge.md.sha1.create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(localCert)).getBytes())
        .digest()
        .toHex()
        .toLowerCase();

      // Check if the certificate file with this specific hash exists
      const caFile = `/usr/local/share/ca-certificates/localnode-ca-${sha1Hash}.crt`;
      
      return fs.existsSync(caFile);
    } catch (error) {
      // If we can't check, assume not installed
      return false;
    }
  }

  getManualInstructions(caCertPath) {
    // Calculate hash for the manual instructions
    let hashSuffix = '';
    try {
      const localCertPem = fs.readFileSync(caCertPath, 'utf8');
      const localCert = forge.pki.certificateFromPem(localCertPem);
      const sha1Hash = forge.md.sha1.create()
        .update(forge.asn1.toDer(forge.pki.certificateToAsn1(localCert)).getBytes())
        .digest()
        .toHex()
        .toLowerCase();
      hashSuffix = `-${sha1Hash}`;
    } catch (error) {
      // If we can't read cert, just show generic instructions
      hashSuffix = '-<hash>';
    }

    return {
      title: 'Linux:',
      instructions: [
        '# Remove any old LocalNode certificates',
        'sudo rm -f /usr/local/share/ca-certificates/localnode-ca-*.crt',
        '',
        '# Install the new certificate',
        `sudo cp "${caCertPath}" /usr/local/share/ca-certificates/localnode-ca${hashSuffix}.crt`,
        'sudo update-ca-certificates'
      ]
    };
  }
}

class UnsupportedInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    const logger = createLogger('PlatformInstaller');
    logger.warn('CA installation not supported on this platform');
    return false;
  }

  async isCAInstalled(caCertPath) {
    // For unsupported platforms, we can't verify installation
    return false;
  }

  getManualInstructions(caCertPath) {
    return {
      title: 'Unsupported Platform:',
      instructions: [
        'Please refer to your operating system documentation for installing CA certificates.'
      ]
    };
  }
}

export function createPlatformInstaller() {
  const platform = process.platform;
  
  switch (platform) {
    case 'darwin':
      return new MacOSInstaller();
    case 'win32':
      return new WindowsInstaller();
    case 'linux':
      return new LinuxInstaller();
    default:
      return new UnsupportedInstaller();
  }
}

export { PlatformInstaller, MacOSInstaller, WindowsInstaller, LinuxInstaller, UnsupportedInstaller };

