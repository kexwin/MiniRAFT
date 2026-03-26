/**
 * Simple logging utility for distributed nodes
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export class Logger {
  constructor(
    private nodeId: string,
    private minLevel: LogLevel = LogLevel.INFO
  ) {}

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const nodeLabel = `[${this.nodeId}]`;
    const baseMsg = `${timestamp} ${nodeLabel} ${level}: ${message}`;
    return data ? `${baseMsg} ${JSON.stringify(data)}` : baseMsg;
  }

  debug(message: string, data?: any) {
    if (this.shouldLog(LogLevel.DEBUG)) console.log(this.formatMessage(LogLevel.DEBUG, message, data));
  }

  info(message: string, data?: any) {
    if (this.shouldLog(LogLevel.INFO)) console.log(this.formatMessage(LogLevel.INFO, message, data));
  }

  warn(message: string, data?: any) {
    if (this.shouldLog(LogLevel.WARN)) console.warn(this.formatMessage(LogLevel.WARN, message, data));
  }

  error(message: string, data?: any) {
    if (this.shouldLog(LogLevel.ERROR)) console.error(this.formatMessage(LogLevel.ERROR, message, data));
  }
}
