/**
 * Centralized logging utility for LocalNode
 * Provides consistent formatting, log levels, and context tracking
 */

// Log levels in order of severity
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Default log level (can be overridden via environment variable)
const DEFAULT_LOG_LEVEL = process.env.LOCALNODE_LOG_LEVEL || 'INFO';

class Logger {
  constructor(context = 'LocalNode') {
    this.context = context;
    this.logLevel = LOG_LEVELS[DEFAULT_LOG_LEVEL.toUpperCase()] || LOG_LEVELS.INFO;
  }

  /**
   * Check if a log level should be output
   * @param {number} level - The log level to check
   * @returns {boolean} True if the level should be logged
   */
  shouldLog(level) {
    return level <= this.logLevel;
  }

  /**
   * Format a log message with context and timestamp
   * @param {string} level - The log level name
   * @param {string} message - The log message
   * @param {Object} meta - Additional metadata
   * @returns {string} Formatted log message
   */
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const contextStr = `[${this.context}]`;
    const levelStr = `[${level}]`;
    
    let formattedMessage = `${timestamp} ${contextStr} ${levelStr} ${message}`;
    
    // Add metadata if provided
    if (Object.keys(meta).length > 0) {
      formattedMessage += ` ${JSON.stringify(meta)}`;
    }
    
    return formattedMessage;
  }

  /**
   * Log an error message
   * @param {string} message - The error message
   * @param {Error|Object} error - Error object or metadata
   */
  error(message, error = null) {
    if (!this.shouldLog(LOG_LEVELS.ERROR)) return;
    
    const meta = {};
    if (error instanceof Error) {
      meta.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    } else if (error && typeof error === 'object') {
      Object.assign(meta, error);
    }
    
    console.error(this.formatMessage('ERROR', message, meta));
  }

  /**
   * Log a warning message
   * @param {string} message - The warning message
   * @param {Object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    if (!this.shouldLog(LOG_LEVELS.WARN)) return;
    console.warn(this.formatMessage('WARN', message, meta));
  }

  /**
   * Log an info message
   * @param {string} message - The info message
   * @param {Object} meta - Additional metadata
   */
  info(message, meta = {}) {
    if (!this.shouldLog(LOG_LEVELS.INFO)) return;
    console.log(this.formatMessage('INFO', message, meta));
  }

  /**
   * Log a debug message
   * @param {string} message - The debug message
   * @param {Object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    if (!this.shouldLog(LOG_LEVELS.DEBUG)) return;
    console.log(this.formatMessage('DEBUG', message, meta));
  }

  /**
   * Create a child logger with additional context
   * @param {string} childContext - Additional context to append
   * @returns {Logger} New logger instance with combined context
   */
  child(childContext) {
    const combinedContext = `${this.context}:${childContext}`;
    return new Logger(combinedContext);
  }

  /**
   * Log HTTP request information
   * @param {Object} req - Express request object
   * @param {string} level - Log level (default: INFO)
   */
  logRequest(req, level = 'INFO') {
    const meta = {
      method: req.method,
      url: req.url,
      host: req.get('host'),
      userAgent: req.get('user-agent'),
      ip: req.ip || req.connection.remoteAddress
    };
    
    this[level.toLowerCase()](`${req.method} ${req.url}`, meta);
  }

  /**
   * Log HTTP response information
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {number} duration - Request duration in milliseconds
   */
  logResponse(req, res, duration = null) {
    const meta = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      contentLength: res.get('content-length')
    };
    
    if (duration !== null) {
      meta.duration = `${duration}ms`;
    }
    
    const level = res.statusCode >= 400 ? 'error' : 'info';
    this[level](`${req.method} ${req.url} - ${res.statusCode}`, meta);
  }
}

// Create default logger instance
const defaultLogger = new Logger();

// Export both the class and default instance
export { Logger, defaultLogger as logger };

// Export convenience functions for common use cases
export const createLogger = (context) => new Logger(context);
export const logError = (message, error) => defaultLogger.error(message, error);
export const logWarn = (message, meta) => defaultLogger.warn(message, meta);
export const logInfo = (message, meta) => defaultLogger.info(message, meta);
export const logDebug = (message, meta) => defaultLogger.debug(message, meta);
