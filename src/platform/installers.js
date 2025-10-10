import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import sudo from '@expo/sudo-prompt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const sudoExec = promisify(sudo.exec);

class PlatformInstaller {
  async installCA(caCertPath) {
    throw new Error('installCA must be implemented by subclass');
  }

  getManualInstructions(caCertPath) {
    throw new Error('getManualInstructions must be implemented by subclass');
  }
}

class MacOSInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    try {
      console.log('Installing CA to macOS keychain...');
      console.log('💡 Use Touch ID or enter your password when prompted...');
      
      // Find the app icon - check multiple possible locations
      const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
      
      const options = {
        name: 'Local Node',
        // icns path for macOS only (optional, falls back to default if not found)
        // Note: In production builds, Electron Builder creates icon.icns automatically
        icns: iconPath,
      };
      
      const command = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caCertPath}"`;
      
      await sudoExec(command, options);
      console.log('✅ CA installed to macOS keychain successfully');
      return true;
    } catch (error) {
      console.warn('Failed to install CA to macOS keychain:', error.message);
      return false;
    }
  }

  getManualInstructions(caCertPath) {
    return {
      title: 'macOS:',
      instructions: [
        `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caCertPath}"`,
        '',
        'Or double-click the certificate file and add it to System keychain.'
      ]
    };
  }
}

class WindowsInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    try {
      console.log('Installing CA to Windows certificate store...');
      
      const options = {
        name: 'Local Node',
      };
      
      const command = `certutil -addstore -enterprise Root "${caCertPath}"`;
      
      await sudoExec(command, options);
      console.log('✅ CA installed to Windows certificate store successfully');
      return true;
    } catch (error) {
      console.warn('Failed to install CA to Windows certificate store:', error.message);
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
    try {
      console.log('Installing CA to Linux trust store...');
      const caDir = '/usr/local/share/ca-certificates';
      const caFile = path.join(caDir, 'localnode-ca.crt');
      
      const options = {
        name: 'Local Node',
      };
      
      // First copy the certificate
      const copyCommand = `cp "${caCertPath}" "${caFile}"`;
      await sudoExec(copyCommand, options);
      
      // Then update certificates
      const updateCommand = 'update-ca-certificates';
      await sudoExec(updateCommand, options);
      
      console.log('✅ CA installed to Linux trust store successfully');
      return true;
    } catch (error) {
      console.warn('Failed to install CA to Linux trust store:', error.message);
      return false;
    }
  }

  getManualInstructions(caCertPath) {
    return {
      title: 'Linux:',
      instructions: [
        `sudo cp "${caCertPath}" /usr/local/share/ca-certificates/localnode-ca.crt`,
        'sudo update-ca-certificates'
      ]
    };
  }
}

class UnsupportedInstaller extends PlatformInstaller {
  async installCA(caCertPath) {
    console.warn('CA installation not supported on this platform');
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

