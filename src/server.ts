import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { supabase } from './db/supabase';
import { Redis } from '@upstash/redis';
import whatsappRouter from './routes/whatsapp';
import stripeRouter from './routes/stripe';
import adminRouter from './routes/admin';
import bookingRouter from './routes/booking';
import { startCronJobs } from './jobs/scheduler';
import { sendTextMessage } from './services/whatsapp';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'"],
      'form-action': ["'self'", 'https://checkout.stripe.com'],
    },
  },
}));
app.use(cors());

// Rate limiting on webhook endpoints — 100 req/min
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/webhooks', webhookLimiter);

// Stripe webhook needs raw body — must be before express.json()
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// WhatsApp webhook needs raw body for signature verification + parsed JSON
app.use('/webhooks/whatsapp', express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

app.use(express.json());

// Routes
app.use('/webhooks/whatsapp', whatsappRouter);
app.use('/webhooks/stripe', stripeRouter);
app.use('/api/admin', adminRouter);
app.use('/book', bookingRouter);

// Health check
app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};

  // Check Supabase
  try {
    const { error } = await supabase.from('captains').select('id').limit(1);
    checks.database = error ? 'error' : 'connected';
  } catch {
    checks.database = 'disconnected';
  }

  // Check Redis
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    await redis.ping();
    checks.redis = 'connected';
  } catch {
    checks.redis = 'disconnected';
  }

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: '1.0.0',
    services: checks,
  });
});

// Booking success/cancel pages (redirect targets from Stripe)
app.get('/booking/success', (_req, res) => {
  res.send('<html><body><h1>Payment successful!</h1><p>You can close this page and return to WhatsApp.</p></body></html>');
});

app.get('/booking/cancel', (_req, res) => {
  res.send('<html><body><h1>Payment cancelled</h1><p>You can close this page and try again from WhatsApp.</p></body></html>');
});

// Stripe Connect return/refresh pages
app.get('/connect/complete', (_req, res) => {
  res.send('<html><body><h1>Stripe setup complete!</h1><p>Return to WhatsApp — the bot will confirm your account is active.</p></body></html>');
});

app.get('/connect/refresh', (_req, res) => {
  res.send('<html><body><h1>Link expired</h1><p>Return to WhatsApp and type /connect to get a fresh link.</p></body></html>');
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');

  // Send DM to admin for critical errors
  const testNumber = process.env.TEST_WHATSAPP_NUMBER;
  if (testNumber) {
    sendTextMessage(testNumber, `[WataSeat Error] ${err.message}`).catch(() => {});
  }

  // Never expose internal errors to clients
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'WataSeat server started');
  startCronJobs();
});

export default app;
