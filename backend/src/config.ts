import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  chromePath: string;
  defaultLocation: {
    lat: number;
    lon: number;
    label: string;
  };
  sessionsDir: string;
  dataDir: string;
  dbPath: string;
  nodeEnv: string;
}

function requireEnvFloat(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseFloat(val);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '5000', 10),
  chromePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
  defaultLocation: {
    lat: requireEnvFloat('DEFAULT_LAT', 18.5204),
    lon: requireEnvFloat('DEFAULT_LON', 73.8567),
    label: process.env.DEFAULT_LOCATION || 'Kothrud, Pune',
  },
  sessionsDir: path.resolve(__dirname, '..', '.sessions'),
  dataDir: path.resolve(__dirname, '..', 'data'),
  dbPath: path.resolve(__dirname, '..', 'data', 'quickcom.db'),
  nodeEnv: process.env.NODE_ENV || 'development',
};
