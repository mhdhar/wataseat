import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger';
import { supabase } from './db/supabase';
import { Redis } from '@upstash/redis';
import whatsappRouter from './routes/whatsapp';
import stripeRouter from './routes/stripe';
import { startCronJobs } from './jobs/scheduler';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());

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

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'WataSeat server started');
  startCronJobs();
});

export default app;
