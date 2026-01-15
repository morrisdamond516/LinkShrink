import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { features } from '../src/pages/Home';

describe('Home feature list', () => {
  it('exports features with image paths that exist', () => {
    const base = path.join(process.cwd(), 'client', 'public', 'images', 'features');
    expect(features.length).toBeGreaterThan(0);
    features.forEach((f: any) => {
      expect(f.image).toBeTruthy();
      const imgPath = path.join(base, f.image.replace('/images/features/', ''));
      expect(fs.existsSync(imgPath)).toBe(true);
    });
  });
});