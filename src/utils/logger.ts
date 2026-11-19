/**
 * Logger utility for PolyCoder-X
 *
 * This file contains a logging utility for the PolyCoder-X system,
 * providing structured logging with different log levels and contexts.
 * Includes production security measures to prevent sensitive data exposure.
 */

// TDZ PREVENTION: Emergency fix - removed problematic Proxy usage

// CRITICAL: SecurityLevel constants MUST be defined FIRST to prevent initialization errors
const SecurityLevel = {
  PUBLIC: 0,
  INTERNAL: 1,
  SENSITIVE: 2,
  CRITICAL: 3
} as const;

type SecurityLevelType = typeof SecurityLevel[keyof typeof SecurityLevel];

// NUCLEAR FIX: Remove all dependencies on secureLogger to prevent initialization order issues
// logger.ts must be completely self-contained

// Environment detection - more robust for Vite builds
const viteEnv =
  typeof import.meta !== 'undefined' && typeof (import.meta as { env?: Record<string, unknown> }).env !== 'undefined'
    ? (import.meta as { env?: { PROD?: boolean; MODE?: string } }).env
    : undefined;

const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

const isProduction = Boolean(
  (viteEnv?.PROD ?? false) ||
  (viteEnv?.MODE === 'production') ||
  nodeEnv === 'production' ||
  (typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !window.location.hostname.includes('local'))
);

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

// Current log level (can be changed at runtime)
let currentLogLevel = LogLevel.INFO;

// Log contexts for different components
export enum LogContext {
  DATABASE = 'DATABASE',
  SYNC = 'SYNC',
  STATE = 'STATE',
  CACHE = 'CACHE',
  CONFLICT = 'CONFLICT',
  PERFORMANCE = 'PERFORMANCE',
  GENERAL = 'GENERAL',
  TEST = 'TEST',
  EVOLUTION = 'EVOLUTION',
  EVALUATION = 'EVALUATION',
  EXECUTION = 'EXECUTION',
  PROMPT = 'PROMPT',
  SECURITY = 'SECURITY',
  MONITORING = 'MONITORING',
  API = 'API'
}

// Metrics storage for performance monitoring
const metrics: Record<string, number[]> = {};

/**
 * Determine security level based on context and message content
 */
function getSecurityLevel(context: string, message: string): SecurityLevelType {
  const lowerMessage = message.toLowerCase();
  const contextStr = typeof context === 'string' ? context : (context ? String(context) : 'GENERAL');

  // Critical security contexts - never log in production
  if (contextStr === 'SECURITY' || contextStr === 'API') {
    return 3; // CRITICAL
  }

  // Sensitive contexts - development only
  if (contextStr === 'DATABASE' ||
      contextStr === 'PERFORMANCE' ||
      contextStr === 'MONITORING' ||
      lowerMessage.includes('agent') ||
      lowerMessage.includes('ecosystem') ||
      lowerMessage.includes('competition') ||
      lowerMessage.includes('learning') ||
      lowerMessage.includes('state') ||
      lowerMessage.includes('training')) {
    return 2; // SENSITIVE
  }

  // Internal operations - development only
  if (contextStr === 'SYNC' ||
      contextStr === 'EVOLUTION' ||
      contextStr === 'EXECUTION' ||
      lowerMessage.includes('internal') ||
      lowerMessage.includes('debug') ||
      lowerMessage.includes('trace')) {
    return 1; // INTERNAL
  }

  // Public messages - safe for production
  return 0; // PUBLIC
}

/**
 * Format log message with timestamp and context
 */
function formatMessage(level: string, context: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${level} [${context}] ${message}`;
}

/**
 * Check if logging is allowed based on security level and environment
 */
function isLoggingAllowed(securityLevel: SecurityLevelType): boolean {
  if (isProduction && securityLevel >= SecurityLevel.SENSITIVE) {
    return false;
  }
  return true;
}

/**
 * Set the current log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Log a debug message
 */
export function debug(context: string, message: string, data?: unknown): void {
  if (currentLogLevel <= LogLevel.DEBUG) {
    const securityLevel = getSecurityLevel(context, message);
    if (isLoggingAllowed(securityLevel)) {
      const formattedMessage = formatMessage('DEBUG', context, message);
      if (data !== undefined) {
        // eslint-disable-next-line no-console
        console.log(formattedMessage, data);
      } else {
        // eslint-disable-next-line no-console
        console.log(formattedMessage);
      }
    }
  }
}

/**
 * Log an info message
 */
export function info(context: string, message: string, data?: unknown): void {
  if (currentLogLevel <= LogLevel.INFO) {
    const securityLevel = getSecurityLevel(context, message);
    if (isLoggingAllowed(securityLevel)) {
      const formattedMessage = formatMessage('INFO', context, message);
      if (data !== undefined) {
        // eslint-disable-next-line no-console
        console.log(formattedMessage, data);
      } else {
        // eslint-disable-next-line no-console
        console.log(formattedMessage);
      }
    }
  }
}

/**
 * Log a warning message
 */
export function warn(context: string, message: string, data?: unknown): void {
  if (currentLogLevel <= LogLevel.WARN) {
    const securityLevel = getSecurityLevel(context, message);
    if (isLoggingAllowed(securityLevel)) {
      const formattedMessage = formatMessage('WARN', context, message);
      if (data !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(formattedMessage, data);
      } else {
        // eslint-disable-next-line no-console
        console.warn(formattedMessage);
      }
    }
  }
}

export const _debug = debug;
export const _info = info;
export const _warn = warn;
export const _error = error;

/**
 * Log an error message
 */
export function error(context: string, message: string, errorData?: unknown): void {
  if (currentLogLevel <= LogLevel.ERROR) {
    const securityLevel = getSecurityLevel(context, message);
    if (isLoggingAllowed(securityLevel)) {
      const formattedMessage = formatMessage('ERROR', context, message);
      if (errorData !== undefined) {
        // eslint-disable-next-line no-console
        console.error(formattedMessage, errorData);
      } else {
        // eslint-disable-next-line no-console
        console.error(formattedMessage);
      }
    }
  }
}

/**
 * Start a timer and return a function to stop it
 */
export function startTimer(name: string): () => void {
  const startTime = performance.now();
  return () => {
    const duration = performance.now() - startTime;
    recordMetric(name, duration);
  };
}

/**
 * Record a metric for performance monitoring
 */
export function recordMetric(name: string, duration: number): void {
  if (!metrics[name]) {
    metrics[name] = [];
  }
  metrics[name] ??= [];
  metrics[name]?.push(duration);
}

/**
 * Get metrics summary for a specific metric
 */
export function getMetricsSummary(name: string): {
  count: number;
  average: number;
  min: number;
  max: number;
} | null {
  const metricData = metrics[name];
  if (!metricData || metricData.length === 0) {
    return null;
  }

  const sum = metricData.reduce((acc, val) => acc + val, 0);
  const average = sum / metricData.length;
  const min = Math.min(...metricData);
  const max = Math.max(...metricData);

  return {
    count: metricData.length,
    average,
    min,
    max
  };
}

/**
 * Reset all metrics
 */
export function resetMetrics(): void {
  Object.keys(metrics).forEach(key => {
    delete metrics[key];
  });
}

/**
 * Log all metrics
 */
export function logMetrics(): void {
  Object.keys(metrics).forEach(name => {
    const summary = getMetricsSummary(name);
    if (summary) {
      info('PERFORMANCE', `Metric ${name}:`, summary);
    }
  });
}

/**
 * Safe logging context for use in other modules
 */
export class SafeLogContext {
  constructor(private readonly context: string) {}

  debug(message: string, data?: unknown): void {
    debug(this.context, message, data);
  }

  info(message: string, data?: unknown): void {
    info(this.context, message, data);
  }

  warn(message: string, data?: unknown): void {
    warn(this.context, message, data);
  }

  error(message: string, errorData?: unknown): void {
    error(this.context, message, errorData);
  }
}

/**
 * Create a safe logging context
 */
export function createLogContext(context: string): SafeLogContext {
  return new SafeLogContext(context);
}
