type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...(data && { data }),
  };

  if (process.env.NODE_ENV === 'production') {
    console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
  } else {
    const colour = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
    console[level === 'debug' ? 'log' : level](
      `${colour[level]}[${timestamp}] [${level.toUpperCase()}]\x1b[0m ${message}`,
      data ? data : ''
    );
  }
}

export const logger = {
  info:  (msg: string, data?: any) => log('info',  msg, data),
  warn:  (msg: string, data?: any) => log('warn',  msg, data),
  error: (msg: string, data?: any) => log('error', msg, data),
  debug: (msg: string, data?: any) => log('debug', msg, data),
};