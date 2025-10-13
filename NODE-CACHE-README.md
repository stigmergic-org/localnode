# Node Cache Management

LocalNode now includes a built-in cache management interface available at `https://node.localhost`.

## Features

The node.localhost page provides:

- **Domain List**: View all cached ENS domains (.eth domains you've visited)
- **Favicon Display**: Each domain shows its favicon (extracted from the cached index.html)
- **Size Information**: 
  - **Total Size**: Complete size of the IPFS content tree
  - **Local Size**: Amount of data stored locally in your IPFS node
- **Cache Actions**:
  - **Inspect Files**: Opens the IPFS WebUI to browse the domain's files
  - **Clear Cache**: Removes the cached content for that domain

## Usage

1. **Access the Interface**: Navigate to `https://node.localhost` in your browser
2. **View Cached Domains**: All domains you've visited will be listed with their metadata
3. **Inspect Content**: Click "Inspect Files" to browse the IPFS content in the WebUI
4. **Clear Cache**: Click the bin icon to remove cached content for a specific domain

## Technical Details

### API Endpoints

The cache management system provides these API endpoints:

- `GET /api/cached-domains` - Returns all cached domains with metadata
- `POST /api/clear-cache?domain=example.eth` - Clears cache for a specific domain

### Size Calculation

- **Total Size**: Retrieved from IPFS DAG statistics, showing the complete content size
- **Local Size**: Determined by checking which blocks are stored locally in your IPFS node

### Favicon Extraction

Favicons are extracted from each domain's `index.html` file and displayed as base64-encoded data URLs. The system supports:
- `.ico` files (default)
- `.png` files  
- `.jpg/.jpeg` files
- `.gif` files
- `.svg` files

### IPFS Integration

The cache management interface integrates with your local IPFS node to:
- Calculate accurate size information
- Provide direct links to the IPFS WebUI for content inspection
- Enable efficient cache clearing by removing only the stored references

## Security

The node.localhost interface is only accessible locally and requires the LocalNode SSL certificate to be trusted in your system.
