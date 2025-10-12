# IPFS Integration

LocalNode now ships with **batteries included** IPFS support powered by kubo.

## How It Works

LocalNode intelligently manages IPFS connectivity:

### 1. Existing IPFS Installation (Preferred)
If you have kubo/IPFS already installed and running on the standard port **5001**, LocalNode will automatically detect and use it:
- **API Port**: 5001 (standard)
- **Gateway Port**: 8080 (standard)

This is the ideal setup if you're already running IPFS for other applications.

### 2. Managed IPFS Instance (Automatic Fallback)
If no existing IPFS installation is detected on port 5001, LocalNode will automatically:
- Download and install kubo via npm
- Start a managed IPFS instance with optimized ports:
  - **API Port**: 5001 (standard)
  - **Gateway Port**: 58080 (custom to avoid common conflicts with port 8080)
  - **Swarm Ports**: 4001 (standard TCP/UDP with QUIC and WebTransport)

The custom gateway port avoids conflicts with other services commonly running on port 8080 (like development servers).

### Security

The managed IPFS instance is configured with secure defaults:
- **CORS**: API access is restricted to `https://webui.ipfs.io` only
- **Gateway**: No CORS headers (access is proxied through LocalNode)
- **WebUI**: Available at http://localhost:5001/webui

## Configuration

IPFS runs on well-defined ports and requires no configuration:

- **API Port**: 5001 (standard, not configurable)
- **Gateway Port**: Automatically detected from IPFS configuration
  - Existing IPFS: Uses whatever port is configured (typically 8080)
  - Managed IPFS: Uses port 58080 to avoid conflicts
- **Swarm Ports**: 4001 (standard)

LocalNode automatically detects if IPFS is running on port 5001. If not found, it starts a managed instance.

## Data Storage

When LocalNode starts a managed IPFS instance, it stores data in:
```
~/.localnode/ipfs/
```

This keeps the managed instance separate from any system IPFS installation (which typically uses `~/.ipfs`).

## Architecture

The IPFS integration is handled by the `IPFSManager` class in `src/ipfs/ipfs-manager.js`:

1. **Initialization**: On startup, checks for existing IPFS on port 5001
2. **Fallback**: If not found, starts a managed instance using `ipfsd-ctl` and the `kubo` binary
3. **Integration**: Provides API URL to the rest of the application
4. **Cleanup**: Automatically stops managed instance on application shutdown

## Troubleshooting

### Checking IPFS Status
The application logs will indicate which IPFS mode is active:
- "Found existing IPFS node" → Using system IPFS
- "Starting managed IPFS instance" → Using embedded IPFS

### Manual IPFS Installation
To use your own IPFS installation:

1. Install kubo: https://docs.ipfs.tech/install/
2. Start the daemon: `ipfs daemon`
3. Ensure it's running on port 5001
4. Restart LocalNode

LocalNode will automatically detect and use your IPFS daemon.

## Dependencies

- **`kubo`**: The Go-IPFS binary distribution
- **`ipfsd-ctl`**: Controller for spawning and managing IPFS daemon processes

These are installed automatically when you run `pnpm install`.

