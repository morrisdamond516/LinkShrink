/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import request from 'supertest';

// Mock Stripe to return a paid session
const mockSession = {
  payment_status: 'paid',
  metadata: { planName: 'PRO', userId: '1' },
  amount_total: 1500,
  customer_details: { email: 'test@example.com' },
};

const mockRetrieve = vi.fn().mockResolvedValue(mockSession);

vi.mock('stripe', () => {
  return vi.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve: mockRetrieve } },
    webhooks: { constructEvent: vi.fn() },
  }));
});

// Mock db methods used in routes.ts
const mockOnConflict = vi.fn().mockResolvedValue(undefined);
const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflict });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockWhere = vi.fn().mockResolvedValue([]);
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

vi.mock('../db', () => ({ db: { insert: mockInsert, update: mockUpdate } }));

let app: express.Express;
let httpServer: any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/confirm-checkout', async () => {
  it('retrieves session and writes payment to DB', async () => {
    app = express();
    app.use(express.json());
    httpServer = createServer(app);

    // import after mocks are setup
    const { registerRoutes } = await import('../routes');
    await registerRoutes(httpServer, app);

    const res = await request(app).get('/api/confirm-checkout').query({ session_id: 'sess_123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);

    expect(mockRetrieve).toHaveBeenCalledWith('sess_123');
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess_123', plan: 'PRO' }));
    expect(mockSet).toHaveBeenCalled();
  });
});