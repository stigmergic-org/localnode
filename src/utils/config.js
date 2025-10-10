import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.localnode');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Default configuration
const DEFAULT_CONFIG = {
  // Helios light client configuration
  consensusRpc: 'https://ethereum.operationsolarstorm.org',
  executionRpc: 'https://mainnet.gateway.tenderly.co',
  // IPFS configuration
  ipfsApiUrl: 'http://localhost:5001',
  // Server configuration
  domain: 'localhost',
  port: 443,
};

// Ensure config directory exists
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Get the config directory path
export function getConfigDir() {
  ensureConfigDir();
  return CONFIG_DIR;
}

// Get the certs directory path
export function getCertsDir() {
  const certsDir = path.join(CONFIG_DIR, 'certs');
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }
  return certsDir;
}

// Get the cache directory path
export function getCacheDir() {
  const cacheDir = path.join(CONFIG_DIR, 'cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

// Load configuration
export function loadConfig() {
  ensureConfigDir();
  
  if (!fs.existsSync(CONFIG_FILE)) {
    // Create default config if it doesn't exist
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    // Merge with defaults in case new fields were added
    return { ...DEFAULT_CONFIG, ...config };
  } catch (error) {
    console.error('Error loading config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

// Save configuration
export function saveConfig(config) {
  ensureConfigDir();
  
  try {
    const configToSave = { ...DEFAULT_CONFIG, ...config };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// Get a specific config value
export function getConfigValue(key) {
  const config = loadConfig();
  return config[key];
}

// Set a specific config value
export function setConfigValue(key, value) {
  const config = loadConfig();
  config[key] = value;
  return saveConfig(config);
}

