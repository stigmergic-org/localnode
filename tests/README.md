# RPC Compliance Tests

This directory contains comprehensive tests for the Ethereum JSON-RPC implementation using [viem](https://viem.sh/).

## Test Files

- **`viem-integration.test.js`** - Comprehensive RPC tests using viem library (validates both compliance and real-world usage)
- **`setup.js`** - Test environment configuration and server startup/teardown

## Philosophy

We use viem for all testing because if viem works, your RPC is compliant. Viem is the industry-standard Ethereum library, so if it can successfully interact with your endpoint, you know the RPC implementation is correct.

## Prerequisites

1. **Install test dependencies:**
   ```bash
   pnpm install
   ```

2. **That's it!** The tests will automatically start the server, wait for Helios to sync, run all tests, and shut down the server.

## Running Tests

Run all tests (auto-starts server):
```bash
pnpm test
```

Run specific test file:
```bash
pnpm test rpc-compliance
```

Run tests in watch mode:
```bash
pnpm test --watch
```

Run tests with coverage:
```bash
pnpm test --coverage
```

## Test Coverage

### What's Tested

**Core RPC Methods:**
- ✅ Block operations (eth_blockNumber, eth_getBlockByNumber)
- ✅ Account queries (eth_getBalance, eth_getTransactionCount, eth_getCode)
- ✅ Network info (eth_chainId, eth_gasPrice)
- ✅ Event logs (eth_getLogs)

**JSON-RPC 2.0 Protocol:**
- ✅ Batch requests (single endpoint, multiple calls)
- ✅ Proper response formatting
- ✅ Error handling (tested implicitly by viem)

**Real-World Usage:**
- ✅ ENS resolution (name ↔ address, avatars, text records)
- ✅ Smart contract reading (ERC20 tokens)
- ✅ Multi-call operations (efficient batched calls)
- ✅ Event filtering and logs
- ✅ Block watching (real-time updates)

If viem works, your RPC is spec-compliant ✅

## Troubleshooting

### SSL Certificate Errors

If you see SSL certificate errors, ensure:
1. The LocalNode CA certificate is installed on your system
2. The test setup file is properly disabling SSL verification for tests

### Connection Refused

If tests fail with "connection refused", the server may have failed to start. Check:
1. No other process is using port 443 (requires sudo/admin)
2. Certificates are properly generated
3. IPFS is running on the configured API URL

### Helios Not Synced

The tests automatically wait for Helios to sync before running. The first sync can take 1-2 minutes. If you see timeout errors, the sync may be taking longer than expected - you can increase `hookTimeout` in `vitest.config.js`

### Timeout Errors

If tests timeout:
1. Increase test timeout in `vitest.config.js`
2. Check your internet connection (Helios needs to sync with Ethereum)
3. Ensure your machine isn't under heavy load

## Writing New Tests

To add new tests:

1. Create a new test file in the `tests/` directory
2. Import necessary viem functions
3. Use the RPC_URL constant: `https://ethereum.node.localhost`
4. Follow the existing test structure

Example:
```javascript
import { describe, it, expect } from 'vitest';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const RPC_URL = 'https://ethereum.node.localhost';

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL)
});

describe('My New Tests', () => {
  it('should do something', async () => {
    const result = await client.getBlockNumber();
    expect(result).toBeTypeOf('bigint');
  }, 30000); // 30 second timeout
});
```

## Continuous Integration

To run tests in CI:

1. Ensure the server can start headlessly
2. Wait for Helios sync before running tests
3. Set appropriate timeouts
4. Consider caching Helios state to speed up subsequent runs

## References

- [Ethereum JSON-RPC Specification](https://ethereum.org/en/developers/docs/apis/json-rpc/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Viem Documentation](https://viem.sh/)
- [Vitest Documentation](https://vitest.dev/)

