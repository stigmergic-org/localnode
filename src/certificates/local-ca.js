import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { createPlatformDialog } from '../platform/dialogs.js';
import { createPlatformInstaller } from '../platform/installers.js';

class LocalCA {
  constructor(certDir) {
    this.certDir = certDir;
    this.caCertPath = path.join(certDir, 'ca-cert.pem');
    this.serverKeyPath = path.join(certDir, 'key.pem');
    this.serverCertPath = path.join(certDir, 'cert.pem');
    // CA private key is kept in memory only (never written to disk)
    this.caPrivateKey = null;
    this.caCertificate = null;
  }

  async initialize(skipInstallPrompt = false) {
    // Create certificates directory if it doesn't exist
    if (!fs.existsSync(this.certDir)) {
      fs.mkdirSync(this.certDir, { recursive: true });
    }

    // Check if certificates exist and are valid
    const certificatesExist = fs.existsSync(this.caCertPath) && 
                             fs.existsSync(this.serverKeyPath) && fs.existsSync(this.serverCertPath);

    if (certificatesExist) {
      const isValid = await this.validateCertificates();
      if (isValid) {
        console.log('SSL certificates already exist and are valid');
        return;
      } else {
        console.log('Existing certificates are weak or invalid, regenerating...');
        this.removeOldCertificates();
      }
    }

    console.log('Creating local Certificate Authority...');
    await this.createCA();
    
    // Only prompt for installation if not skipped (for CLI mode)
    if (!skipInstallPrompt) {
      await this.promptForCAInstallation();
    }
  }

  async createCA() {
    // Generate CA key pair with stronger key size
    const caKeys = forge.pki.rsa.generateKeyPair(4096);
    
    // Create CA certificate
    const caCert = forge.pki.createCertificate();
    caCert.publicKey = caKeys.publicKey;
    caCert.serialNumber = '01';
    caCert.validity.notBefore = new Date();
    caCert.validity.notAfter = new Date();
    caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);

    const caAttrs = [
      { name: 'commonName', value: 'LocalNode Local CA' },
      { name: 'organizationName', value: 'LocalNode' },
      { name: 'organizationalUnitName', value: 'Development' },
      { name: 'countryName', value: 'US' },
      { shortName: 'ST', value: 'Local' },
      { name: 'localityName', value: 'Local' }
    ];

    caCert.setSubject(caAttrs);
    caCert.setIssuer(caAttrs);

    // Add extensions
    caCert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        cRLSign: true
      },
      {
        name: 'subjectKeyIdentifier'
      }
    ]);

    // Sign CA certificate with SHA-256
    caCert.sign(caKeys.privateKey, forge.md.sha256.create());

    // Store CA key and cert in memory (never write private key to disk for security)
    this.caPrivateKey = caKeys.privateKey;
    this.caCertificate = caCert;

    // Save only the CA certificate (public) to disk
    const caCertPem = forge.pki.certificateToPem(caCert);
    fs.writeFileSync(this.caCertPath, caCertPem);

    console.log('🔒 Local CA created successfully (private key kept in memory only)');
  }

  async promptForCAInstallation() {
    console.log('\n🔐 Certificate Authority Setup');
    console.log('⏭️  Automatic CA installation is disabled.');
    console.log('💡 Your browser will show a security warning when you visit .eth sites.');
    console.log('   You can click "Advanced" → "Proceed" to accept the certificate.\n');
    
    this.showManualInstallationInstructions();
  }

  async showInstallationDialog() {
    const dialog = createPlatformDialog();
    return await dialog.showInstallationDialog();
  }

  async promptForCAInstallationCLI() {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const answer = await new Promise((resolve) => {
        rl.question('Would you like to install the CA to your system trust store? (y/N): ', resolve);
      });

      if (answer.toLowerCase().startsWith('y')) {
        console.log('\nInstalling CA to system trust store...');
        const success = await this.installCAToSystem();
        
        if (success) {
          console.log('✅ CA installed successfully! Your browser will now trust certificates automatically.');
          console.log('⚠️  Please restart your browser for the changes to take effect.');
        } else {
          console.log('❌ Failed to install CA. You can install it manually later.');
          this.showManualInstallationInstructions();
        }
      } else {
        console.log('\n⏭️  Skipping CA installation.');
        console.log('💡 You can install it later if you want to avoid browser warnings.');
        this.showManualInstallationInstructions();
      }
    } finally {
      rl.close();
    }
  }

  async installCAToSystem() {
    const installer = createPlatformInstaller();
    return await installer.installCA(this.caCertPath);
  }

  async isCertificateInstalled() {
    // Delegate to platform-specific installer
    const installer = createPlatformInstaller();
    return await installer.isCAInstalled(this.caCertPath);
  }

  showManualInstallationInstructions() {
    const installer = createPlatformInstaller();
    const instructions = installer.getManualInstructions(this.caCertPath);
    
    console.log('\n📋 Manual CA Installation Instructions:');
    console.log(`   CA certificate location: ${this.caCertPath}`);
    console.log('\n🔧 Installation commands:');
    console.log(`   ${instructions.title}`);
    
    instructions.instructions.forEach(line => {
      if (line) {
        console.log(`   ${line}`);
      } else {
        console.log('');
      }
    });
    
    console.log('\n💡 Alternative: Accept the security warning in your browser when first visiting a site.');
    console.log('   The certificate will work, but you\'ll see a warning until the CA is installed.');
  }

  async validateCertificates() {
    try {
      // Check if server certificate is valid
      const serverCertPem = fs.readFileSync(this.serverCertPath, 'utf8');
      const serverCert = forge.pki.certificateFromPem(serverCertPem);
      
      // Check key size (should be at least 2048 bits)
      const serverKeyPem = fs.readFileSync(this.serverKeyPath, 'utf8');
      const serverKey = forge.pki.privateKeyFromPem(serverKeyPem);
      
      if (serverKey.keySize < 2048) {
        console.log('Certificate key size too small:', serverKey.keySize, 'bits');
        return false;
      }
      
      // Check if certificate is expired
      const now = new Date();
      if (serverCert.validity.notAfter < now) {
        console.log('Certificate has expired');
        return false;
      }
      
      // Check if certificate expires soon (within 30 days)
      const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
      if (serverCert.validity.notAfter < thirtyDaysFromNow) {
        console.log('Certificate expires soon, regenerating...');
        return false;
      }
      
      // Check signature algorithm (should be SHA-256 or better)
      const signatureAlgorithm = serverCert.signatureAlgorithm.oid;
      if (signatureAlgorithm === '1.2.840.113549.1.1.5' || // SHA-1 with RSA
          signatureAlgorithm === '1.2.840.113549.1.1.4') { // MD5 with RSA
        console.log('Certificate uses weak signature algorithm, regenerating...');
        return false;
      }
      
      return true;
    } catch (error) {
      console.log('Error validating certificates:', error.message);
      return false;
    }
  }

  removeOldCertificates() {
    try {
      const files = [this.caCertPath, this.serverKeyPath, this.serverCertPath];
      files.forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
      console.log('Removed old certificates');
    } catch (error) {
      console.warn('Error removing old certificates:', error.message);
    }
  }


  async generateServerCertificate(domain) {
    console.log('Generating server certificate...');

    // Check if server certificate already exists
    if (fs.existsSync(this.serverKeyPath) && fs.existsSync(this.serverCertPath)) {
      console.log('Server certificate already exists');
      return;
    }

    // Use in-memory CA key and cert (more secure - never touches disk)
    if (!this.caPrivateKey || !this.caCertificate) {
      throw new Error('CA not initialized. Call createCA() first.');
    }
    
    const caKey = this.caPrivateKey;
    const caCert = this.caCertificate;

    // Generate server key pair with stronger key size
    const serverKeys = forge.pki.rsa.generateKeyPair(4096);

    // Create server certificate
    const serverCert = forge.pki.createCertificate();
    serverCert.publicKey = serverKeys.publicKey;
    serverCert.serialNumber = '02';
    serverCert.validity.notBefore = new Date();
    serverCert.validity.notAfter = new Date();
    serverCert.validity.notAfter.setFullYear(serverCert.validity.notBefore.getFullYear() + 1);

    const serverAttrs = [
      { name: 'commonName', value: `*.eth.${domain}` },
      { name: 'organizationName', value: 'LocalNode' },
      { name: 'organizationalUnitName', value: 'Development' },
      { name: 'countryName', value: 'US' },
      { shortName: 'ST', value: 'Local' },
      { name: 'localityName', value: 'Local' }
    ];

    serverCert.setSubject(serverAttrs);
    serverCert.setIssuer(caCert.subject.attributes);

    // Add extensions
    serverCert.setExtensions([
      {
        name: 'basicConstraints',
        cA: false
      },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true
      },
      {
        name: 'subjectAltName',
        altNames: [
          {
            type: 2, // DNS
            value: `*.eth.${domain}`
          },
          {
            type: 2, // DNS
            value: `eth.${domain}`
          },
          {
            type: 2, // DNS
            value: `*.node.${domain}`
          },
          {
            type: 2, // DNS
            value: `node.${domain}`
          }
        ]
      }
    ]);

    // Sign server certificate with CA using SHA-256
    serverCert.sign(caKey, forge.md.sha256.create());

    // Save server certificate files
    const serverKeyPem = forge.pki.privateKeyToPem(serverKeys.privateKey);
    const serverCertPem = forge.pki.certificateToPem(serverCert);

    fs.writeFileSync(this.serverKeyPath, serverKeyPem);
    fs.writeFileSync(this.serverCertPath, serverCertPem);

    console.log('✅ Server certificate generated and signed by local CA');
    console.log('🔒 CA private key never written to disk (kept in memory only)');
    console.log('Your browser should now trust this certificate automatically');
  }
}

export { LocalCA };
