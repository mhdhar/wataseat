import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { sendTemplateMessage } from '../services/whatsapp';

const router = Router();

// Verify admin secret on all requests
router.use((req: Request, res: Response, next) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Send WhatsApp template message
router.post('/send-whatsapp', async (req: Request, res: Response) => {
  const { to, templateName, templateParams } = req.body;

  if (!to || !templateName) {
    res.status(400).json({ error: 'Missing required fields: to, templateName' });
    return;
  }

  try {
    await sendTemplateMessage(to, templateName, templateParams || []);
    logger.info({ to, templateName }, 'Admin WhatsApp message sent');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, to, templateName }, 'Admin WhatsApp send failed');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
