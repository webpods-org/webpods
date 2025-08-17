/**
 * Version management module
 * Reads and caches the version from package.json on startup
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('version');

// Cache the version on module load
let cachedVersion: string | null = null;

/**
 * Get the application version from package.json
 * Version is cached on first read for performance
 */
export function getVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  try {
    // Get package.json path relative to this module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, '..', 'package.json');
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const version = packageJson.version || '0.0.0';
    cachedVersion = version;
    
    logger.debug('Version loaded from package.json', { version: cachedVersion });
    return version;
  } catch (error) {
    logger.error('Failed to read version from package.json', { error });
    // Fallback to a default version if package.json cannot be read
    const fallbackVersion = '0.0.0';
    cachedVersion = fallbackVersion;
    return fallbackVersion;
  }
}

/**
 * Get the full version string with app name
 */
export function getFullVersion(): string {
  return `webpods v${getVersion()}`;
}