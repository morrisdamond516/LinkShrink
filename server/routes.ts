import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import Stripe from "stripe";
import crypto from 'crypto';
import { db } from "./db";
import { payments, users, urls } from "@shared/schema";
import { hashPassword, verifyPassword, generateSessionToken } from './auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-12-15.clover" as any,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Stripe Checkout Session Endpoint
  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      const { planName, amount, customerEmail } = req.body;

      // try to identify the user from session cookie
      let userId: number | undefined = undefined;
      const token = req.cookies?.session_token;
      if (token) {
        const [user] = await db.select().from(users).where(users.sessionToken.eq(token));
        if (user) userId = user.id;
      }

      const metadata: Record<string, string> = { planName: String(planName) };
      if (userId) metadata.userId = String(userId);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${planName} Plan`,
                description: `Unlock all premium LinkShrink features with the ${planName} plan.`,
              },
              unit_amount: parseInt(String(amount)) * 100,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata,
        success_url: `${req.protocol}://${req.get("host")}/#features?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.protocol}://${req.get("host")}/pricing`,
      });

      res.json({ id: session.id });
    } catch (err: any) {
      console.error("Stripe Error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  // API Routes
  app.post(api.shortener.create.path, async (req, res) => {
    try {
      const input = api.shortener.create.input.parse(req.body);

      // Determine actor: logged-in user or anonymous
      let actor: { type: 'user' | 'anon'; id: string | number } | null = null;
      const token = req.cookies?.session_token;
      if (token) {
        const [owner] = await db.select().from(users).where(users.sessionToken.eq(token));
        if (owner) actor = { type: 'user', id: owner.id };
      }

      // If anonymous, ensure anon_id cookie exists
      let anonId = req.cookies?.anon_id;
      if (!anonId) {
        anonId = crypto.randomBytes(12).toString('hex');
        res.cookie('anon_id', anonId, { httpOnly: false, maxAge: 1000 * 60 * 60 * 24 * 365 * 2 }); // 2 years
      }

      // Enforce free plan quota (5 per calendar month)
      const limit = 5;
      let used = 0;
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      // determine effective plan
      let effectivePlan = 'FREE';
      if (actor?.type === 'user') {
        const [u] = await db.select().from(users).where(users.id.eq(Number(actor.id)));
        if (u) effectivePlan = u.plan || 'FREE';
      }

      if (effectivePlan === 'FREE') {
        const who = actor ? `user:${actor.id}` : `anon:${anonId}`;
        const [countResult] = await db.select({ c: db.raw('count(*)') }).from(urls).where(urls.createdBy.eq(who)).where(urls.createdAt.gte(startOfMonth as any));
        used = Number((countResult as any)?.c || 0);
        if (used >= limit) {
          return res.status(402).json({ message: `Free plan limit reached (${limit} links/month). Please upgrade.` });
        }
      }

      const createdBy = actor ? `user:${actor.id}` : `anon:${anonId}`;
      const url = await storage.createUrl(input, createdBy);
      
      // Construct the short URL. 
      const protocol = req.protocol;
      const host = req.get('host');
      const shortUrl = `${protocol}://${host}/${url.shortCode}`;

      res.status(201).json({
        shortCode: url.shortCode,
        shortUrl: shortUrl
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        console.error('Shorten error', err);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.get(api.shortener.get.path, async (req, res) => {
    const url = await storage.getUrl(req.params.shortCode);
    if (!url) {
      return res.status(404).json({ message: "URL not found" });
    }
    res.json(url);
  });

  // Return quota for free shortener
  app.get('/api/shorten/quota', async (req, res) => {
    try {
      const limit = 5;

      // Determine actor
      let actor: { type: 'user' | 'anon'; id: string | number } | null = null;
      const token = req.cookies?.session_token;
      if (token) {
        const [owner] = await db.select().from(users).where(users.sessionToken.eq(token));
        if (owner) actor = { type: 'user', id: owner.id };
      }

      let who = 'anon:unknown';
      if (actor) {
        who = `user:${actor.id}`;
      } else {
        let anonId = req.cookies?.anon_id;
        if (!anonId) {
          anonId = crypto.randomBytes(12).toString('hex');
          res.cookie('anon_id', anonId, { httpOnly: false, maxAge: 1000 * 60 * 60 * 24 * 365 * 2 });
        }
        who = `anon:${anonId}`;
      }

      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const [countResult] = await db.select({ c: db.raw('count(*)') }).from(urls).where(urls.createdBy.eq(who)).where(urls.createdAt.gte(startOfMonth as any));
      const used = Number((countResult as any)?.c || 0);
      res.json({ limit, used, remaining: Math.max(0, limit - used) });
    } catch (err: any) {
      console.error('quota error', err);
      res.status(500).json({ message: 'Failed to compute quota' });
    }
  });

  // Auth endpoints
  app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ message: 'Missing required fields' });

    try {
      const hashed = hashPassword(String(password));
      const sessionToken = generateSessionToken();
      const [user] = await db.insert(users).values({ username: String(username), email: String(email), passwordHash: hashed, sessionToken }).returning();
      // set cookie
      res.cookie('session_token', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
      res.json({ id: user.id, username: user.username, email: user.email, plan: user.plan });
    } catch (err: any) {
      console.error('Registration error', err);
      res.status(500).json({ message: err.message || 'Registration failed' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });

    try {
      const [user] = await db.select().from(users).where(users.email.eq(String(email)));
      if (!user) return res.status(401).json({ message: 'Invalid credentials' });
      if (!verifyPassword(String(password), user.passwordHash)) return res.status(401).json({ message: 'Invalid credentials' });

      const sessionToken = generateSessionToken();
      await db.update(users).set({ sessionToken }).where(users.id.eq(user.id));
      res.cookie('session_token', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
      res.json({ id: user.id, username: user.username, email: user.email, plan: user.plan });
    } catch (err: any) {
      console.error('Login error', err);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  app.get('/api/me', async (req, res) => {
    const token = req.cookies?.session_token;
    if (!token) return res.status(204).json({});
    try {
      const [user] = await db.select().from(users).where(users.sessionToken.eq(String(token)));
      if (!user) return res.status(204).json({});
      res.json({ id: user.id, username: user.username, email: user.email, plan: user.plan });
    } catch (err: any) {
      console.error('me error', err);
      res.status(500).json({ message: 'Failed to fetch user' });
    }
  });

  // Return Stripe publishable key to client (read from env)
  app.get('/api/stripe-publishable-key', (_req, res) => {
    const key = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!key) return res.status(500).json({ message: 'Publishable key not configured' });
    res.json({ publishableKey: key });
  });

  // Confirm checkout session server-side to avoid spoofing
  app.get('/api/confirm-checkout', async (req, res) => {
    const sessionId = String(req.query.session_id || '');
    if (!sessionId) return res.status(400).json({ message: 'Missing session_id' });

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId as string);
      // For one-time payment, check payment_status field
      const paid = (session.payment_status === 'paid');
      const planName = (session.metadata && session.metadata.planName) || undefined;

      if (!paid) {
        return res.status(402).json({ message: 'Payment not completed' });
      }

      // store payment record if not already present
      try {
        await db.insert(payments).values({
          sessionId,
          plan: planName || 'PAID',
          amount: Number(session.amount_total) || 0,
          customerEmail: session.customer_details?.email,
        }).onConflictDoNothing();
      } catch (e) {
        console.error('Could not store payment record', e);
      }

      // If the session has a userId in metadata, update that user's plan
      try {
        const userId = session.metadata?.userId;
        if (userId) {
          await db.update(users).set({ plan: planName || 'PAID' }).where(users.id.eq(Number(userId)));
        }
      } catch (e) {
        console.error('Failed to attach plan to user', e);
      }

      return res.json({ success: true, plan: planName || null });
    } catch (err: any) {
      console.error('Error confirming checkout session', err);
      return res.status(500).json({ message: 'Failed to confirm session' });
    }
  });

  // Stripe webhook endpoint (optional): configure STRIPE_WEBHOOK_SECRET for signature verification
  app.post('/api/webhook', async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const sig = (req.headers['stripe-signature'] as string) || '';
    let event: any;

    try {
      if (webhookSecret) {
        event = stripe.webhooks.constructEvent(req.rawBody as Buffer, sig, webhookSecret);
      } else {
        // If no webhook secret configured, accept the raw body (not recommended for production)
        event = req.body;
      }
    } catch (err: any) {
      console.error('Webhook signature verification failed.', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      try {
        await db.insert(payments).values({
          sessionId: session.id,
          plan: session.metadata?.planName || 'PAID',
          amount: Number(session.amount_total) || 0,
          customerEmail: session.customer_details?.email,
        }).onConflictDoNothing();
      } catch (e) {
        console.error('Failed to record payment from webhook', e);
      }

      // If a userId is present in metadata, update the user's plan
      try {
        const userId = session.metadata?.userId;
        if (userId) {
          await db.update(users).set({ plan: session.metadata?.planName || 'PAID' }).where(users.id.eq(Number(userId)));
        } else if (session.customer_details?.email) {
          // fallback: try to match user by email
          await db.update(users).set({ plan: session.metadata?.planName || 'PAID' }).where(users.email.eq(session.customer_details.email));
        }
      } catch (e) {
        console.error('Failed to attach plan to user from webhook', e);
      }
    }

    res.json({ received: true });
  });

  // Redirect Route
  // We place this before the static handler so it captures the short codes.
  app.get('/:shortCode', async (req, res, next) => {
    const shortCode = req.params.shortCode;
    
    // Ignore common static files or API routes if they slip through (though /api is handled above)
    if (shortCode.startsWith('api') || shortCode.includes('.')) {
      return next();
    }

    try {
      const url = await storage.getUrl(shortCode);
      if (url) {
        // Increment stats asynchronously
        storage.incrementVisit(shortCode).catch(console.error);
        
        return res.redirect(url.originalUrl);
      }
      
      // If not found, fall through to the frontend (404 page)
      next();
    } catch (err) {
      next(err);
    }
  });

  return httpServer;
}
