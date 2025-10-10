import { describe, it, expect } from 'vitest';
import { createPublicClient, http, parseEther } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

/**
 * Viem Integration Tests
 * Tests that viem can successfully use our RPC endpoint
 * for real-world Ethereum operations
 * 
 * These tests validate both RPC compliance AND practical usage
 */

const RPC_URL = 'https://ethereum.node.localhost';

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL)
});

describe('Ethereum RPC via Viem', () => {
  
  describe('Basic RPC Methods', () => {
    
    it('should get current block number (eth_blockNumber)', async () => {
      const blockNumber = await client.getBlockNumber();
      expect(blockNumber).toBeTypeOf('bigint');
      expect(blockNumber).toBeGreaterThan(0n);
      console.log(`✓ Current block number: ${blockNumber}`);
    }, 30000);

    it('should get chain ID (eth_chainId)', async () => {
      const chainId = await client.getChainId();
      expect(chainId).toBe(1); // Mainnet
      console.log(`✓ Chain ID: ${chainId}`);
    }, 30000);

    it('should get gas price (eth_gasPrice)', async () => {
      const gasPrice = await client.getGasPrice();
      expect(gasPrice).toBeTypeOf('bigint');
      expect(gasPrice).toBeGreaterThan(0n);
      console.log(`✓ Gas price: ${gasPrice} wei`);
    }, 30000);

    it('should get latest block (eth_getBlockByNumber)', async () => {
      const block = await client.getBlock();
      expect(block).toBeDefined();
      expect(block.number).toBeTypeOf('bigint');
      expect(block.hash).toBeDefined();
      console.log(`✓ Latest block: ${block.number}`);
    }, 30000);
    
  });

  describe('Account Operations', () => {

    const vitalikAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    it('should get account balance (eth_getBalance)', async () => {
      const balance = await client.getBalance({ address: vitalikAddress });
      expect(balance).toBeTypeOf('bigint');
      console.log(`✓ Vitalik's balance: ${balance} wei`);
    }, 30000);

    it('should get transaction count (eth_getTransactionCount)', async () => {
      const txCount = await client.getTransactionCount({ address: vitalikAddress });
      expect(txCount).toBeTypeOf('number');
      expect(txCount).toBeGreaterThan(0);
      console.log(`✓ Transaction count: ${txCount}`);
    }, 30000);

    it('should get code for contract address (eth_getCode)', async () => {
      // ENS Registry contract
      const ensRegistry = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
      const code = await client.getBytecode({ address: ensRegistry });
      expect(code).toBeDefined();
      expect(code).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(code.length).toBeGreaterThan(2); // More than just "0x"
      console.log(`✓ Contract code length: ${code.length} chars`);
    }, 30000);

  });

  describe('ENS Resolution', () => {

    it('should resolve ENS name to address', async () => {
      const address = await client.getEnsAddress({
        name: normalize('vitalik.eth')
      });
      
      expect(address).toBeDefined();
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      console.log(`✓ vitalik.eth resolves to: ${address}`);
    }, 30000);

    it('should resolve address to ENS name', async () => {
      const name = await client.getEnsName({
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      });
      
      expect(name).toBeDefined();
      console.log(`✓ Address resolves to: ${name}`);
    }, 30000);

    it('should get ENS avatar', async () => {
      const avatar = await client.getEnsAvatar({
        name: normalize('vitalik.eth')
      });
      
      // Avatar may or may not be set
      console.log(`✓ vitalik.eth avatar: ${avatar || 'not set'}`);
    }, 30000);

    it('should get ENS text records', async () => {
      const twitter = await client.getEnsText({
        name: normalize('vitalik.eth'),
        key: 'com.twitter'
      });
      
      console.log(`✓ vitalik.eth twitter: ${twitter || 'not set'}`);
    }, 30000);

  });

  describe('Block Operations', () => {

    it('should watch for new blocks', async () => {
      return new Promise((resolve) => {
        let blocksReceived = 0;
        
        const unwatch = client.watchBlockNumber({
          onBlockNumber: (blockNumber) => {
            blocksReceived++;
            console.log(`✓ New block: ${blockNumber}`);
            
            expect(blockNumber).toBeTypeOf('bigint');
            
            if (blocksReceived >= 2) {
              unwatch();
              resolve();
            }
          },
          pollingInterval: 4000
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          unwatch();
          if (blocksReceived === 0) {
            throw new Error('No blocks received within 30 seconds');
          }
          resolve();
        }, 30000);
      });
    }, 35000);

    it('should get multiple blocks efficiently', async () => {
      const latestBlock = await client.getBlockNumber();
      
      // Get last 5 blocks
      const blocks = await Promise.all([
        client.getBlock({ blockNumber: latestBlock }),
        client.getBlock({ blockNumber: latestBlock - 1n }),
        client.getBlock({ blockNumber: latestBlock - 2n }),
        client.getBlock({ blockNumber: latestBlock - 3n }),
        client.getBlock({ blockNumber: latestBlock - 4n })
      ]);
      
      expect(blocks.length).toBe(5);
      blocks.forEach((block, i) => {
        expect(block.number).toBe(latestBlock - BigInt(i));
      });
      
      console.log(`✓ Retrieved blocks ${latestBlock - 4n} to ${latestBlock}`);
    }, 30000);

  });

  describe('Smart Contract Interaction', () => {

    it('should read from ERC20 contract (USDC)', async () => {
      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      
      // Read name
      const name = await client.readContract({
        address: usdcAddress,
        abi: [{
          name: 'name',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'string' }]
        }],
        functionName: 'name'
      });
      
      expect(name).toBe('USD Coin');
      console.log(`✓ USDC name: ${name}`);
    }, 30000);

    it('should read from ERC20 contract (symbol and decimals)', async () => {
      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      
      const erc20Abi = [
        {
          name: 'symbol',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'string' }]
        },
        {
          name: 'decimals',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'uint8' }]
        }
      ];
      
      const [symbol, decimals] = await Promise.all([
        client.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'symbol'
        }),
        client.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'decimals'
        })
      ]);
      
      expect(symbol).toBe('USDC');
      expect(decimals).toBe(6);
      console.log(`✓ USDC: ${symbol} (${decimals} decimals)`);
    }, 30000);

    it('should read balance from ERC20 contract', async () => {
      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const vitalikAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      
      const balance = await client.readContract({
        address: usdcAddress,
        abi: [{
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ type: 'address' }],
          outputs: [{ type: 'uint256' }]
        }],
        functionName: 'balanceOf',
        args: [vitalikAddress]
      });
      
      expect(balance).toBeTypeOf('bigint');
      console.log(`✓ Vitalik's USDC balance: ${balance}`);
    }, 30000);

  });

  describe('Transaction Simulation', () => {

    it('should simulate ETH transfer', async () => {
      const fromAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      
      // Get current state for the account
      const gasPrice = await client.getGasPrice();
      const nonce = await client.getTransactionCount({ address: fromAddress });
      
      const estimate = await client.estimateGas({
        account: fromAddress,
        to: '0x0000000000000000000000000000000000000000',
        value: parseEther('0.001'),
        nonce,
        gasPrice,
        gas: 21000n,
        blockTag: 'latest'
      });
      
      expect(estimate).toBeGreaterThan(0n);
      console.log(`✓ Gas estimate for 0.001 ETH transfer: ${estimate}`);
    }, 30000);

    it('should simulate contract call', async () => {
      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      
      try {
        // This will fail (no approval) but should still estimate
        const estimate = await client.estimateContractGas({
          address: usdcAddress,
          abi: [{
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { type: 'address', name: 'to' },
              { type: 'uint256', name: 'amount' }
            ],
            outputs: [{ type: 'bool' }]
          }],
          functionName: 'transfer',
          args: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 1000000n],
          account: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
        });
        
        console.log(`✓ Gas estimate for USDC transfer: ${estimate}`);
      } catch (error) {
        // Expected to fail, but error should be from contract logic, not RPC
        console.log(`✓ Simulation failed as expected: ${error.message.slice(0, 100)}...`);
      }
    }, 30000);

  });

  describe('Event Filtering', () => {

    it('should filter Transfer events', async () => {
      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const vitalikAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      
      const logs = await client.getLogs({
        address: usdcAddress,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { type: 'address', indexed: true, name: 'from' },
            { type: 'address', indexed: true, name: 'to' },
            { type: 'uint256', indexed: false, name: 'value' }
          ]
        },
        args: {
          to: vitalikAddress
        },
        fromBlock: 18000000n,
        toBlock: 18000100n
      });
      
      console.log(`✓ Found ${logs.length} USDC transfers to Vitalik in blocks 18000000-18000100`);
    }, 30000);

  });

  describe('Multi-call Operations', () => {

    it('should perform multiple calls efficiently', async () => {
      const results = await client.multicall({
        contracts: [
          {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            abi: [{
              name: 'name',
              type: 'function',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ type: 'string' }]
            }],
            functionName: 'name'
          },
          {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            abi: [{
              name: 'symbol',
              type: 'function',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ type: 'string' }]
            }],
            functionName: 'symbol'
          },
          {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            abi: [{
              name: 'decimals',
              type: 'function',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ type: 'uint8' }]
            }],
            functionName: 'decimals'
          }
        ]
      });
      
      expect(results.length).toBe(3);
      console.log(`✓ Multicall results:`, results.map(r => r.result));
    }, 30000);

  });

  describe('JSON-RPC 2.0 Protocol', () => {

    it('should handle batch requests', async () => {
      // Batch requests are part of JSON-RPC 2.0 spec
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 },
          { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 2 },
          { jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 3 }
        ])
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(3);
      
      // Each response should be valid JSON-RPC 2.0
      data.forEach((item, index) => {
        expect(item).toHaveProperty('jsonrpc', '2.0');
        expect(item).toHaveProperty('result');
        expect(item).toHaveProperty('id', index + 1);
      });
      
      console.log(`✓ Batch request returned ${data.length} responses`);
    }, 30000);

  });

});

