# LocalNode

A system tray application that creates a local version of eth.limo, allowing you to access ENS sites with `https://your-domain.eth.localhost`.

## Features

- 🌐 Local ENS resolution using Ethereum RPC
- 📁 IPFS content serving via Kubo node
- 🔒 HTTPS with locally-trusted certificates
- 🎯 Subdomain routing for `*.eth.localhost`
- ⚙️ Settings UI for easy configuration
- 🖥️ System tray app for macOS with menu bar icon
- 💾 Persistent configuration in `~/.localnode`

## Installation

```bash
npm install -g localnode
```

## Usage

### Running the App

```bash
npm start
```

This will start LocalNode as a system tray application with a menu bar icon.

The tray menu provides:
- 💎 Quick access to ENS sites
- 🌐 IPFS Web UI link
- ⚙️ Settings window
- 🚪 Quit option

### Settings

Click "Settings" in the tray menu to open the configuration window where you can set:

- **Ethereum RPC URL** - Your Ethereum node endpoint (default: `http://localhost:8545`)
- **IPFS Gateway URL** - Your IPFS gateway endpoint (default: `http://localhost:8080`)

All settings are automatically saved to `~/.localnode/config.json` and loaded on startup.

### Configuration Directory

LocalNode stores all its data in `~/.localnode/`:
- `config.json` - Your configuration settings
- `certs/` - SSL certificates for HTTPS

## Prerequisites

1. **Ethereum Node**: You need a running Ethereum node (like Geth, Parity, or Infura) for ENS resolution
2. **IPFS Gateway**: You need a running IPFS gateway (like Kubo's HTTP gateway) for content serving
3. **SSL Certificate**: The tool will generate self-signed certificates automatically

## Examples

Once running, you can access ENS sites like:

- `https://vitalik.eth.localhost` - Vitalik's ENS site
- `https://ethereum.eth.localhost` - Ethereum's ENS site
- `https://your-domain.eth.localhost` - Any ENS domain

## How It Works

1. **ENS Resolution**: The tool resolves ENS domains to IPFS content hashes using the Universal Resolver
2. **IPFS Gateway**: Proxies requests to your local IPFS gateway using the resolved hash
3. **HTTPS Serving**: Serves the content over HTTPS with self-signed certificates
4. **Subdomain Routing**: Routes `*.eth.localhost` subdomains to the appropriate ENS domains

## Configuration

LocalNode uses the following default configuration stored in `~/.localnode/config.json`:

```json
{
  "ethereumRpc": "http://localhost:8545",
  "ipfsGateway": "http://localhost:8080",
  "domain": "localhost",
  "port": 443,
}
```

You can modify these settings through the Settings UI (recommended) or by editing the config file directly.

## Troubleshooting

### SSL Certificate Warnings

Since the tool uses self-signed certificates, your browser will show security warnings. You can:

1. Click "Advanced" and "Proceed to site"
2. Add the certificate to your browser's trusted certificates
3. Use a tool like `mkcert` to generate locally trusted certificates

### ENS Resolution Issues

If ENS domains aren't resolving:

1. Check that your Ethereum RPC is accessible
2. Verify the ENS domain exists and has a content hash set
3. Check the console logs for specific error messages

### IPFS Issues

If content isn't loading:

1. Ensure your IPFS gateway is running and accessible
2. Check that the IPFS hash exists in your gateway
3. Verify the IPFS gateway URL is correct

## Development

To run from source:

```bash
git clone <repository>
cd localnode
pnpm install
pnpm start
```

## Building

### Install Dependencies

First, install electron-builder:

```bash
pnpm install
```

### Build Commands

Build distributable packages:

```bash
# Build for macOS (DMG and ZIP for both Intel and Apple Silicon)
pnpm run build:mac

# Build for Linux (deb and AppImage)
pnpm run build:linux

# Build for both macOS and Linux
pnpm run build:all
```

### Build Output

Built packages will be in the `dist/` directory:

**macOS:**
- `dist/Local Node-0.1.0-arm64.dmg` - Apple Silicon DMG installer
- `dist/Local Node-0.1.0-x64.dmg` - Intel DMG installer
- `dist/Local Node-0.1.0-arm64-mac.zip` - Apple Silicon ZIP
- `dist/Local Node-0.1.0-x64-mac.zip` - Intel ZIP

**Linux:**
- `dist/localnode_0.1.0_amd64.deb` - Debian package
- `dist/Local Node-0.1.0.AppImage` - Portable AppImage

### Installing the Built App

**macOS:**
```bash
# Open the DMG and drag to Applications
open dist/Local\ Node-*.dmg

# Or install from ZIP
unzip dist/Local\ Node-*-mac.zip -d /Applications/
```

**Linux (Debian/Ubuntu):**
```bash
sudo dpkg -i dist/localnode_*.deb
```

**Linux (AppImage):**
```bash
chmod +x dist/Local\ Node-*.AppImage
./dist/Local\ Node-*.AppImage
```

## License

MIT
