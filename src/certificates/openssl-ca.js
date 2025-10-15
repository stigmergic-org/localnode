import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import tls from 'tls';
import { createPlatformDialog } from '../platform/dialogs.js';
import { createPlatformInstaller } from '../platform/installers.js';
import { createLogger } from '../utils/logger.js';

const execAsync = promisify(exec);

/**
 * OpenSSL-based Certificate Authority for LocalNode
 * Supports both OpenSSL and LibreSSL on macOS
 * Creates a root CA and intermediate CA with NameConstraints for security
 */
class OpenSSLCA {
  constructor(certDir) {
    this.certDir = certDir;
    this.logger = createLogger('OpenSSLCA');
    
    // Root CA paths
    this.rootCertPath = path.join(certDir, 'root-ca-cert.pem');
    // Root CA private key kept in memory only (never persisted)
    this.rootPrivateKeyPem = null;
    
    // Intermediate CA paths (only for .eth.localhost subdomains)
    this.intermediateKeyPath = path.join(certDir, 'intermediate-ca-key.pem');
    this.intermediateCertPath = path.join(certDir, 'intermediate-ca-cert.pem');
    
    // Shared server key for all leaf certificates
    this.serverKeyPath = path.join(certDir, 'server-key.pem');
    
    // eth.localhost certificate (signed directly by root CA)
    this.ethCertPath = path.join(certDir, 'eth-cert.pem');
    
    // node.localhost certificate (signed directly by root CA)
    this.nodeCertPath = path.join(certDir, 'node-cert.pem');
    
    // Track generated certificates for cleanup
    this.generatedCerts = new Map(); // domain pattern -> { keyPath, certPath }
    
    // Detect OpenSSL/LibreSSL
    this.opensslPath = this.detectOpenSSL();
  }

  /**
   * Detect OpenSSL or LibreSSL on the system
   */
  detectOpenSSL() {
    try {
      // Try to find OpenSSL or LibreSSL
      const version = execSync('openssl version', { encoding: 'utf8' });
      this.logger.info(`Detected: ${version.trim()}`);
      
      // Check if it's LibreSSL or OpenSSL
      if (version.includes('LibreSSL')) {
        this.logger.info('Using LibreSSL (macOS default)');
      } else if (version.includes('OpenSSL')) {
        this.logger.info('Using OpenSSL');
      }
      
      return 'openssl'; // Command is the same for both
    } catch (error) {
      throw new Error('OpenSSL or LibreSSL not found. Please install OpenSSL.');
    }
  }

  /**
   * Execute an OpenSSL command (async)
   */
  async execOpenSSL(args, options = {}) {
    const cmd = `${this.opensslPath} ${args}`;
    this.logger.debug(`Executing: ${cmd}`);
    
    try {
      const { stdout, stderr } = await execAsync(cmd, options);
      if (stderr && !options.ignoreStderr) {
        this.logger.debug(`OpenSSL stderr: ${stderr}`);
      }
      return stdout;
    } catch (error) {
      this.logger.error(`OpenSSL command failed: ${cmd}`, error);
      throw error;
    }
  }

  /**
   * Execute an OpenSSL command synchronously (for SNI callback)
   */
  execOpenSSLSync(args, options = {}) {
    const cmd = `${this.opensslPath} ${args}`;
    this.logger.debug(`Executing (sync): ${cmd}`);
    
    try {
      const output = execSync(cmd, { encoding: 'utf8', ...options });
      return output;
    } catch (error) {
      this.logger.error(`OpenSSL command failed: ${cmd}`, error);
      throw error;
    }
  }

  /**
   * Initialize the CA system
   * Root CA key is only generated and used during initial setup, never persisted
   */
  async initialize(skipInstallPrompt = false) {
    // Create certificates directory if it doesn't exist
    if (!fs.existsSync(this.certDir)) {
      fs.mkdirSync(this.certDir, { recursive: true });
    }

    // Check if we have all required certificates (indicator of complete setup)
    const allCertsExist = fs.existsSync(this.intermediateCertPath) && 
                          fs.existsSync(this.intermediateKeyPath) &&
                          fs.existsSync(this.ethCertPath) &&
                          fs.existsSync(this.nodeCertPath);
    
    if (!allCertsExist) {
      // First-time setup or incomplete setup: Generate everything
      this.logger.info('First-time setup: Creating CA hierarchy and certificates');
      
      // Generate root CA with in-memory private key
      await this.createRootCA();
      
      // Create intermediate CA signed by root CA
      this.logger.info('Creating Intermediate Certificate Authority with NameConstraints');
      await this.createIntermediateCA();
      
      // Generate all certificates while we still have root CA key in memory
      await this.generateEthCertificate('localhost');
      await this.generateNodeCertificate('localhost');
      
      // Root CA private key is now discarded (only in memory, will be garbage collected)
      this.logger.info('Root CA private key discarded from memory');
    } else {
      this.logger.info('CA hierarchy and certificates already exist');
    }

    // Only prompt for installation if not skipped (for CLI mode)
    if (!skipInstallPrompt) {
      await this.promptForCAInstallation();
    }
  }

  /**
   * Create the Root CA (private key in memory only)
   */
  async createRootCA() {
    // Generate root CA private key in memory (4096-bit RSA)
    this.rootPrivateKeyPem = await this.execOpenSSL('genrsa 4096');
    this.logger.info('Root CA private key generated (in memory only)');

    // Write key to temporary file for certificate generation
    const tempKeyPath = path.join(this.certDir, '.temp-root-key.pem');
    fs.writeFileSync(tempKeyPath, this.rootPrivateKeyPem);

    // Create root CA certificate (valid for 10 years)
    const rootSubject = '/C=US/ST=Local/L=Local/O=LocalNode/OU=Development/CN=LocalNode Root CA';
    
    await this.execOpenSSL(
      `req -new -x509 -days 3650 -key "${tempKeyPath}" ` +
      `-out "${this.rootCertPath}" -subj "${rootSubject}" ` +
      `-sha256`
    );
    
    // Immediately delete temporary key file
    fs.unlinkSync(tempKeyPath);
    
    this.logger.info('✅ Root CA created successfully (private key in memory only)');
  }

  /**
   * Create the Intermediate CA with NameConstraints
   * Used ONLY for ENS subdomain certificates (e.g., *.simplepage.eth.localhost)
   * NOT used for the default *.eth.localhost certificate
   */
  async createIntermediateCA() {
    // Generate intermediate CA private key (4096-bit RSA)
    await this.execOpenSSL(
      `genrsa -out "${this.intermediateKeyPath}" 4096`
    );
    this.logger.debug('Intermediate CA private key generated');

    // Create intermediate CA certificate signing request
    const intermediateCSRPath = path.join(this.certDir, 'intermediate-ca.csr');
    const intermediateSubject = '/C=US/ST=Local/L=Local/O=LocalNode/OU=Development/CN=LocalNode Intermediate CA (ENS Subdomains)';
    
    await this.execOpenSSL(
      `req -new -key "${this.intermediateKeyPath}" ` +
      `-out "${intermediateCSRPath}" -subj "${intermediateSubject}"`
    );
    
    // Create intermediate CA extensions config - ONLY for .eth.localhost
    // This constraint ensures the intermediate CA can ONLY issue certs for ENS subdomains
    const intermediateExtPath = path.join(this.certDir, 'intermediate-ext.cnf');
    const intermediateExtConfig = `[v3_intermediate_ca]
basicConstraints = critical,CA:true,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer:always
nameConstraints = critical,permitted;DNS:.eth.localhost
`;
    
    fs.writeFileSync(intermediateExtPath, intermediateExtConfig);
    
    // Write root key to temp file for signing
    const tempRootKeyPath = path.join(this.certDir, '.temp-root-key.pem');
    fs.writeFileSync(tempRootKeyPath, this.rootPrivateKeyPem);
    
    // Sign intermediate CA with root CA (valid for 10 years)
    await this.execOpenSSL(
      `x509 -req -in "${intermediateCSRPath}" ` +
      `-CA "${this.rootCertPath}" -CAkey "${tempRootKeyPath}" ` +
      `-CAcreateserial -out "${this.intermediateCertPath}" ` +
      `-days 3650 -sha256 -extfile "${intermediateExtPath}" ` +
      `-extensions v3_intermediate_ca`
    );
    
    // Immediately delete temporary root key
    fs.unlinkSync(tempRootKeyPath);
    
    // Clean up other temporary files
    fs.unlinkSync(intermediateCSRPath);
    fs.unlinkSync(intermediateExtPath);
    
    this.logger.info('✅ Intermediate CA created (ENS subdomains only, NameConstraints: .eth.localhost)');
  }

  /**
   * Generate or get the shared server key (reused for all leaf certs)
   */
  ensureServerKey() {
    if (!fs.existsSync(this.serverKeyPath)) {
      this.logger.info('Generating shared server key (2048-bit RSA)');
      this.execOpenSSLSync(`genrsa -out "${this.serverKeyPath}" 2048`);
      this.logger.info('✅ Shared server key created');
    }
    return this.serverKeyPath;
  }

  /**
   * Generate a wildcard certificate synchronously (for SNI callback)
   * Uses shared server key for efficiency
   * e.g., for "blog.simplepage.eth.localhost" -> generates "wildcard-simplepage-eth-cert.pem"
   */
  generateWildcardCertificateSync(hostname, domain = 'localhost') {
    // Extract the ENS name pattern
    const pattern = this.extractENSPattern(hostname, domain);
    
    if (!pattern) {
      throw new Error(`Cannot extract ENS pattern from hostname: ${hostname}`);
    }

    // Check if we already have a certificate for this pattern
    if (this.generatedCerts.has(pattern)) {
      this.logger.debug(`Certificate already exists for pattern: ${pattern}`);
      return this.generatedCerts.get(pattern);
    }

    this.logger.info(`Generating wildcard certificate (sync) for: ${pattern}`);

    // Use shared server key (reused for all leaf certs)
    const keyPath = this.ensureServerKey();

    // Generate certificate path
    const certBaseName = pattern.replace(/\*/g, 'wildcard').replace(/\./g, '-');
    const certPath = path.join(this.certDir, `${certBaseName}-cert.pem`);

    // Create certificate signing request
    const csrPath = path.join(this.certDir, `${certBaseName}.csr`);
    const subject = `/C=US/ST=Local/L=Local/O=LocalNode/OU=Development/CN=${pattern}`;
    
    this.execOpenSSLSync(
      `req -new -key "${keyPath}" -out "${csrPath}" -subj "${subject}"`
    );

    // Create SAN extensions config
    const extPath = path.join(this.certDir, `${certBaseName}-ext.cnf`);
    let sanConfig = `[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${pattern}
`;
    
    // Add the base domain without wildcard if it's a wildcard cert
    if (pattern.startsWith('*.')) {
      const baseDomain = pattern.substring(2);
      sanConfig += `DNS.2 = ${baseDomain}\n`;
    }
    
    fs.writeFileSync(extPath, sanConfig);

    // Sign certificate with intermediate CA (valid for 1 year)
    this.execOpenSSLSync(
      `x509 -req -in "${csrPath}" ` +
      `-CA "${this.intermediateCertPath}" -CAkey "${this.intermediateKeyPath}" ` +
      `-CAcreateserial -out "${certPath}" ` +
      `-days 365 -sha256 -extfile "${extPath}" -extensions v3_req`
    );

    // Clean up temporary files
    fs.unlinkSync(csrPath);
    fs.unlinkSync(extPath);

    // Store in cache (note: all certs share the same key)
    const certInfo = { keyPath, certPath, pattern };
    this.generatedCerts.set(pattern, certInfo);

    this.logger.info(`✅ Certificate generated (sync) for ${pattern} using shared key`);
    return certInfo;
  }

  /**
   * Extract ENS pattern from hostname
   * Examples:
   *   blog.simplepage.eth.localhost -> *.simplepage.eth.localhost
   *   simplepage.eth.localhost -> *.eth.localhost
   *   vitalik.eth.localhost -> *.eth.localhost
   */
  extractENSPattern(hostname, domain = 'localhost') {
    const suffix = `.eth.${domain}`;
    
    if (!hostname.endsWith(suffix)) {
      return null;
    }

    // Remove the suffix to get the ENS part
    const ensPath = hostname.slice(0, -suffix.length);
    
    // Split by dots to analyze the structure
    const parts = ensPath.split('.');
    
    if (parts.length === 1) {
      // Simple case: vitalik.eth.localhost -> *.eth.localhost
      return `*.eth.${domain}`;
    } else {
      // Subdomain case: blog.simplepage.eth.localhost -> *.simplepage.eth.localhost
      // Keep the last part and make the rest wildcard
      const rootName = parts[parts.length - 1];
      return `*.${rootName}.eth.${domain}`;
    }
  }

  /**
   * Generate the eth.localhost certificate (signed by root CA during initial setup)
   * Note: This requires root CA private key, so can only be done during initialization
   */
  async generateEthCertificate(domain = 'localhost') {
    this.logger.info('Generating eth.localhost certificate');

    // Use shared server key
    const keyPath = this.ensureServerKey();

    // Create certificate signing request
    const csrPath = path.join(this.certDir, 'eth.csr');
    const subject = `/C=US/ST=Local/L=Local/O=LocalNode/OU=Development/CN=*.eth.${domain}`;
    
    await this.execOpenSSL(
      `req -new -key "${keyPath}" -out "${csrPath}" -subj "${subject}"`
    );

    // Create SAN extensions config
    const extPath = path.join(this.certDir, 'eth-ext.cnf');
    const sanConfig = `[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = *.eth.${domain}
DNS.2 = eth.${domain}
`;
    
    fs.writeFileSync(extPath, sanConfig);

    // Write root key to temp file for signing
    const tempRootKeyPath = path.join(this.certDir, '.temp-root-key.pem');
    fs.writeFileSync(tempRootKeyPath, this.rootPrivateKeyPem);

    // Sign certificate DIRECTLY with root CA (valid for 1 year)
    await this.execOpenSSL(
      `x509 -req -in "${csrPath}" ` +
      `-CA "${this.rootCertPath}" -CAkey "${tempRootKeyPath}" ` +
      `-CAcreateserial -out "${this.ethCertPath}" ` +
      `-days 365 -sha256 -extfile "${extPath}" -extensions v3_req`
    );

    // Immediately delete temporary root key
    fs.unlinkSync(tempRootKeyPath);

    this.logger.info(`Generated eth.localhost cert at: ${this.ethCertPath}`);

    // Clean up temporary files
    fs.unlinkSync(csrPath);
    fs.unlinkSync(extPath);

    this.logger.info('✅ eth.localhost certificate generated (signed by root CA)');
  }

  /**
   * Generate node.localhost certificate (signed directly by root CA during initial setup)
   * Note: This requires root CA private key, so can only be done during initialization
   */
  async generateNodeCertificate(domain = 'localhost') {
    this.logger.info('Generating node.localhost certificate');

    // Use shared server key
    const keyPath = this.ensureServerKey();

    // Create certificate signing request
    const csrPath = path.join(this.certDir, 'node.csr');
    const subject = `/C=US/ST=Local/L=Local/O=LocalNode/OU=Development/CN=*.node.${domain}`;
    
    await this.execOpenSSL(
      `req -new -key "${keyPath}" -out "${csrPath}" -subj "${subject}"`
    );

    // Create SAN extensions config
    const extPath = path.join(this.certDir, 'node-ext.cnf');
    const sanConfig = `[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = *.node.${domain}
DNS.2 = node.${domain}
`;
    
    fs.writeFileSync(extPath, sanConfig);

    // Write root key to temp file for signing
    const tempRootKeyPath = path.join(this.certDir, '.temp-root-key.pem');
    fs.writeFileSync(tempRootKeyPath, this.rootPrivateKeyPem);

    // Sign certificate DIRECTLY with root CA (valid for 1 year)
    await this.execOpenSSL(
      `x509 -req -in "${csrPath}" ` +
      `-CA "${this.rootCertPath}" -CAkey "${tempRootKeyPath}" ` +
      `-CAcreateserial -out "${this.nodeCertPath}" ` +
      `-days 365 -sha256 -extfile "${extPath}" -extensions v3_req`
    );

    // Immediately delete temporary root key
    fs.unlinkSync(tempRootKeyPath);

    this.logger.info(`Generated node.localhost cert at: ${this.nodeCertPath}`);

    // Clean up temporary files
    fs.unlinkSync(csrPath);
    fs.unlinkSync(extPath);

    this.logger.info('✅ node.localhost certificate generated (signed by root CA)');
  }

  /**
   * Get certificate chain for intermediate CA certificates
   * (intermediate + root, used only for ENS subdomain certs)
   */
  getIntermediateCertificateChain() {
    const intermediate = fs.readFileSync(this.intermediateCertPath, 'utf8');
    const root = fs.readFileSync(this.rootCertPath, 'utf8');
    return intermediate + '\n' + root;
  }

  /**
   * Get root certificate (used for default certs signed by root CA)
   */
  getRootCertificate() {
    return fs.readFileSync(this.rootCertPath, 'utf8');
  }

  /**
   * Get the SNI (Server Name Indication) callback for dynamic certificate loading
   */
  getSNICallback(domain = 'localhost') {
    return (servername, callback) => {
      // Handle edge cases
      if (!servername) {
        this.logger.warn('SNI callback invoked with no servername, using default cert');
        return callback(null); // Use default context
      }
      
      this.logger.info(`SNI callback invoked for: ${servername}`);
      
      try {
        // Check if this is a node.localhost request - use root CA cert
        if (servername.endsWith(`.node.${domain}`) || servername === `node.${domain}`) {
          this.logger.info(`Using node.localhost certificate for: ${servername}`);
          
          const key = fs.readFileSync(this.serverKeyPath, 'utf8');
          const nodeCert = fs.readFileSync(this.nodeCertPath, 'utf8');
          const rootCert = fs.readFileSync(this.rootCertPath, 'utf8');
          
          // For node.localhost, chain is: node cert + root cert (no intermediate)
          const cert = nodeCert + '\n' + rootCert;
          
          const secureContext = tls.createSecureContext({ key, cert });
          this.logger.info(`Returning node.localhost SecureContext`);
          return callback(null, secureContext);
        }
        
        // Check if this is an ENS subdomain that needs a specific wildcard cert
        const pattern = this.extractENSPattern(servername, domain);
        this.logger.info(`Extracted pattern: ${pattern} for servername: ${servername}`);
        
        // If pattern is null or same as default, use default cert (return null to use default context)
        if (!pattern || pattern === `*.eth.${domain}`) {
          this.logger.info(`Using default certificate context for: ${servername}`);
          return callback(null); // null means use the default context
        }
        
        // Need a specific wildcard certificate for this ENS domain
        let certInfo = this.generatedCerts.get(pattern);
        
        if (!certInfo) {
          // Generate certificate on-demand (synchronously!)
          this.logger.info(`Generating on-demand certificate for: ${servername} (pattern: ${pattern})`);
          certInfo = this.generateWildcardCertificateSync(servername, domain);
        } else {
          this.logger.info(`Using cached certificate for pattern: ${pattern}`);
        }
        
        // Load the certificate and key with full chain
        const key = fs.readFileSync(certInfo.keyPath, 'utf8');
        const serverCert = fs.readFileSync(certInfo.certPath, 'utf8');
        const intermediateCert = fs.readFileSync(this.intermediateCertPath, 'utf8');
        const rootCert = fs.readFileSync(this.rootCertPath, 'utf8');
        
        // Concatenate server cert with intermediate cert and root cert for full chain
        const cert = serverCert + '\n' + intermediateCert + '\n' + rootCert;
        
        // Create a proper SecureContext for this certificate
        this.logger.info(`Creating SecureContext for pattern: ${pattern}`);
        const secureContext = tls.createSecureContext({ key, cert });
        
        this.logger.info(`Returning SecureContext for pattern: ${pattern}`);
        callback(null, secureContext);
      } catch (error) {
        this.logger.error(`Error in SNI callback for ${servername}:`, error);
        // Return error to callback
        callback(error);
      }
    };
  }

  /**
   * Prompt for CA installation
   */
  async promptForCAInstallation() {
    console.log('\n🔐 Certificate Authority Setup');
    console.log('⏭️  Automatic CA installation is disabled.');
    console.log('💡 Your browser will show a security warning when you visit .eth sites.');
    console.log('   You can click "Advanced" → "Proceed" to accept the certificate.\n');
    
    this.showManualInstallationInstructions();
  }

  /**
   * Show installation dialog (for Electron apps)
   */
  async showInstallationDialog() {
    const dialog = createPlatformDialog();
    return await dialog.showInstallationDialog();
  }

  /**
   * Install CA to system trust store
   */
  async installCAToSystem() {
    const installer = createPlatformInstaller();
    // Install root CA (not intermediate) to trust store
    return await installer.installCA(this.rootCertPath);
  }

  /**
   * Check if CA is installed in system trust store
   */
  async isCertificateInstalled() {
    const installer = createPlatformInstaller();
    return await installer.isCAInstalled(this.rootCertPath);
  }

  /**
   * Show manual installation instructions
   */
  showManualInstallationInstructions() {
    const installer = createPlatformInstaller();
    const instructions = installer.getManualInstructions(this.rootCertPath);
    
    console.log('\n📋 Manual CA Installation Instructions:');
    console.log(`   CA certificate location: ${this.rootCertPath}`);
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

  /**
   * Clean up generated certificates (but keep shared key)
   */
  cleanup() {
    // Clean up dynamically generated certificates
    for (const [pattern, certInfo] of this.generatedCerts.entries()) {
      try {
        // Only delete the certificate file (key is shared, don't delete it)
        if (fs.existsSync(certInfo.certPath)) {
          fs.unlinkSync(certInfo.certPath);
        }
        this.logger.debug(`Cleaned up certificate for pattern: ${pattern}`);
      } catch (error) {
        this.logger.error(`Error cleaning up certificate for ${pattern}`, error);
      }
    }
    this.generatedCerts.clear();
  }
}

export { OpenSSLCA };

