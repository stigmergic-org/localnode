/**
 * Express middleware for consistent request/response logging
 */

import { createLogger } from './logger.js';

/**
 * Create logging middleware for Express apps
 * @param {string} context - Context name for the logger (e.g., 'ENS', 'RPC', 'CACHE')
 * @returns {Function} Express middleware function
 */
export function createLoggingMiddleware(context) {
  const logger = createLogger(context);
  
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Log incoming request
    logger.logRequest(req, 'DEBUG');
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;
      logger.logResponse(req, res, duration);
      originalEnd.apply(this, args);
    };
    
    next();
  };
}

/**
 * Error logging middleware for Express apps
 * @param {string} context - Context name for the logger
 * @returns {Function} Express error middleware function
 */
export function createErrorLoggingMiddleware(context) {
  const logger = createLogger(context);
  
  return (error, req, res, next) => {
    logger.error('Request error', {
      method: req.method,
      url: req.url,
      host: req.get('host'),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    });
    
    next(error);
  };
}
