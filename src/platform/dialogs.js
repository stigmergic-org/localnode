import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class PlatformDialog {
  async showInstallationDialog() {
    throw new Error('showInstallationDialog must be implemented by subclass');
  }

  async showSettingsDialog(currentConfig) {
    throw new Error('showSettingsDialog must be implemented by subclass');
  }
}

class MacOSDialog extends PlatformDialog {
  async showInstallationDialog() {
    try {
      const script = `
        display dialog "LocalNode needs to install a Certificate Authority (CA) to your system trust store to avoid browser security warnings.

This requires administrator privileges and will show a password prompt.

Would you like to install the CA now?" buttons {"Skip", "Install"} default button "Install" with icon note
      `;
      
      const result = await execAsync(`osascript -e '${script}'`);
      return result.stdout.includes('Install') ? 'yes' : 'no';
    } catch (error) {
      throw new Error('Failed to show macOS dialog');
    }
  }

  async showSettingsDialog(currentConfig) {
    try {
      // Since macOS display dialog only supports one text field,
      // we use a multi-line text input with clear formatting
      const script = `
        set dialogText to "Edit settings below (one per line):

Line 1: Consensus RPC URL (Helios)
Line 2: Execution RPC URL (Helios)
Line 3: IPFS API URL"
        
        set defaultAnswer to "${currentConfig.consensusRpc}
${currentConfig.executionRpc}
${currentConfig.ipfsApiUrl}"
        
        display dialog dialogText default answer defaultAnswer buttons {"Cancel", "Save"} default button "Save" with title "LocalNode Settings" with icon note
      `;
      
      const result = await execAsync(`osascript -e '${script}'`);
      
      if (!result.stdout.includes('Save')) {
        return null;
      }
      
      // Extract the text from the result
      const textMatch = result.stdout.match(/text returned:([^}]+)/);
      if (!textMatch) {
        return null;
      }
      
      const inputText = textMatch[1].trim();
      const lines = inputText.split(/\\n|\\r\\n|\\r/).map(line => line.trim()).filter(line => line);
      
      if (lines.length < 3) {
        console.error('Invalid input: need consensus RPC, execution RPC, and IPFS API URL');
        return null;
      }
      
      return {
        consensusRpc: lines[0],
        executionRpc: lines[1],
        ipfsApiUrl: lines[2]
      };
    } catch (error) {
      return null;
    }
  }
}

class WindowsDialog extends PlatformDialog {
  async showInstallationDialog() {
    try {
      const script = 'Add-Type -AssemblyName System.Windows.Forms; $result = [System.Windows.Forms.MessageBox]::Show("LocalNode needs to install a Certificate Authority (CA) to your system trust store to avoid browser security warnings.\n\nThis requires administrator privileges and will show a password prompt.\n\nWould you like to install the CA now?", "LocalNode CA Installation", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question); if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { Write-Output "yes" } else { Write-Output "no" }';
      
      const result = await execAsync(`powershell -Command "${script}"`);
      return result.stdout.trim();
    } catch (error) {
      throw new Error('Failed to show Windows dialog');
    }
  }

  async showSettingsDialog(currentConfig) {
    // TODO: Implement Windows native settings dialog
    console.log('Windows settings dialog not yet implemented');
    return null;
  }
}

class LinuxDialog extends PlatformDialog {
  async showInstallationDialog() {
    try {
      const result = await execAsync(`zenity --question --title="LocalNode CA Installation" --text="LocalNode needs to install a Certificate Authority (CA) to your system trust store to avoid browser security warnings.\\n\\nThis requires administrator privileges and will show a password prompt.\\n\\nWould you like to install the CA now?"`);
      return 'yes';
    } catch (error) {
      // zenity returns exit code 1 for "No" button
      if (error.code === 1) {
        return 'no';
      }
      throw new Error('Failed to show Linux dialog');
    }
  }

  async showSettingsDialog(currentConfig) {
    // TODO: Implement Linux native settings dialog (using zenity forms)
    console.log('Linux settings dialog not yet implemented');
    return null;
  }
}

class UnsupportedDialog extends PlatformDialog {
  async showInstallationDialog() {
    throw new Error('System dialog not supported on this platform');
  }

  async showSettingsDialog(currentConfig) {
    throw new Error('System dialog not supported on this platform');
  }
}

export function createPlatformDialog() {
  const platform = process.platform;
  
  switch (platform) {
    case 'darwin':
      return new MacOSDialog();
    case 'win32':
      return new WindowsDialog();
    case 'linux':
      return new LinuxDialog();
    default:
      return new UnsupportedDialog();
  }
}

export { PlatformDialog, MacOSDialog, WindowsDialog, LinuxDialog, UnsupportedDialog };
