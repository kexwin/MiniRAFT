const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[LOG_LEVEL as LogLevel];
  }

  private formatLog(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const logData = data ? ` ${JSON.stringify(data)}` : '';
    return `${timestamp} [${this.context}] ${level}: ${message}${logData}`;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('DEBUG')) console.log(this.formatLog('DEBUG', message, data));
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('INFO')) console.log(this.formatLog('INFO', message, data));
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('WARN')) console.warn(this.formatLog('WARN', message, data));
  }

  error(message: string, data?: any): void {
    if (this.shouldLog('ERROR')) console.error(this.formatLog('ERROR', message, data));
  }
}

export { Logger };
