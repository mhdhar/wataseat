import axios from 'axios';
import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';

const BUCKET_NAME = 'vessel-images';
let bucketEnsured = false;

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: true,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
  });
  if (error && !error.message.includes('already exists')) {
    logger.error({ err: error }, 'Failed to create storage bucket');
    throw error;
  }
  bucketEnsured = true;
}

export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  // Step 1: Get the media URL from Meta Graph API
  const metaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });

  const mediaUrl = metaResponse.data.url;
  const mimeType = metaResponse.data.mime_type || 'image/jpeg';

  // Step 2: Download the actual media binary
  const mediaResponse = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return { buffer: Buffer.from(mediaResponse.data), mimeType };
}

export async function uploadVesselImage(
  captainId: string,
  imageBuffer: Buffer,
  mimeType: string
): Promise<string> {
  await ensureBucket();

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filePath = `${captainId}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, imageBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    logger.error({ err: error, captainId }, 'Failed to upload vessel image');
    throw error;
  }

  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
  logger.info({ captainId, url: data.publicUrl }, 'Vessel image uploaded');
  return data.publicUrl;
}
