import crypto from 'crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derived] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return check === derived;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}