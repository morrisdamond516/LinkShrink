import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const images = [
  'branded-links.svg',
  'analytics.svg',
  'qr.svg',
  'password-protection.svg',
  'expiring-links.svg',
  'bulk.svg',
];

describe('Feature images', () => {
  it('are present in client/public/images/features', () => {
    const base = path.join(process.cwd(), 'client', 'public', 'images', 'features');
    images.forEach((img) => {
      const p = path.join(base, img);
      expect(fs.existsSync(p)).toBe(true);
    });
  });
});