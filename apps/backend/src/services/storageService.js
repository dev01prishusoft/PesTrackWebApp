const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * S3 photo storage. Credentials come from env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * AWS_REGION / AWS_BUCKET_NAME). The client is created lazily so the server can boot without
 * S3 configured — only the photo path requires real credentials.
 *
 * The bucket stays private: we store the object KEY in the DB and hand out short-lived
 * presigned GET URLs for viewing (see presignGet / presignKeys).
 */
let client = null;

const PRESIGN_TTL = 60 * 60; // 1 hour

function isConfigured() {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION &&
      process.env.AWS_BUCKET_NAME
  );
}

function getClient() {
  if (!isConfigured()) {
    throw new Error(
      'S3 storage is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ' +
        'AWS_REGION and AWS_BUCKET_NAME to enable photo uploads.'
    );
  }
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

/**
 * Uploads a single in-memory file (multer memoryStorage: { buffer, mimetype, originalname })
 * to S3 under photos/ and returns its permanent key plus a presigned URL for immediate viewing.
 * @returns {Promise<{ key: string, url: string }>}
 */
async function uploadPhoto(file) {
  const ext = (file.originalname && file.originalname.includes('.'))
    ? file.originalname.slice(file.originalname.lastIndexOf('.'))
    : '.jpg';
  const key = `photos/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'image/jpeg',
    })
  );

  const url = await presignGet(key);
  return { key, url };
}

/**
 * Normalize a client-supplied photo value into the value to STORE in the DB.
 * The client may send back a presigned URL (from a previous read) or a raw key;
 * either way we persist the bare S3 key so future presigns stay valid. Non-S3
 * values (data: URLs, external http URLs) are stored as-is.
 */
function toStorageKey(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('data:')) return value; // inline data, not on S3
  // Presigned/plain S3 URL for our bucket -> strip to the key (path minus query).
  const s3Host = `${process.env.AWS_BUCKET_NAME}.s3.`;
  if (/^https?:\/\//.test(value)) {
    try {
      const u = new URL(value);
      if (u.hostname.startsWith(s3Host)) {
        return decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      }
      return value; // some other external URL — keep it
    } catch {
      return value;
    }
  }
  return value; // already a bare key
}

/**
 * Delete photos from S3 by their stored value (key OR our-bucket URL). Values
 * that aren't objects in our bucket (data: URLs, external http URLs) are
 * skipped. Best-effort: never throws — S3 cleanup must not block a DB delete.
 * S3 supports up to 1000 keys per DeleteObjects call, so we batch.
 */
async function deletePhotos(values) {
  if (!isConfigured() || !Array.isArray(values) || values.length === 0) return;

  // Resolve each stored value to a bare S3 key; drop data:/external URLs.
  const keys = values
    .map((v) => (typeof v === 'string' ? toStorageKey(v) : null))
    .filter((k) => typeof k === 'string' && !/^https?:/.test(k) && !k.startsWith('data:'));
  if (keys.length === 0) return;

  try {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await getClient().send(
        new DeleteObjectsCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
    }
  } catch (err) {
    // Log and move on — orphaned objects are recoverable; a failed request is not
    // worth aborting the surrounding DB transaction over.
    console.error('S3 photo deletion failed (objects may be orphaned):', err.message);
  }
}

/** Time-limited GET URL for a stored key (bucket stays private). */
async function presignGet(key) {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }),
    { expiresIn: PRESIGN_TTL }
  );
}

/**
 * Turn stored values into viewable presigned URLs. Handles keys AND legacy rows
 * that stored a full (unsigned) S3 URL for our own bucket — toStorageKey strips
 * those back to a key so they get signed. data: URLs and genuinely external URLs
 * pass through unchanged. S3 is skipped when not configured.
 */
async function presignKeys(values) {
  if (!isConfigured()) return values;
  return Promise.all(
    values.map((v) => {
      if (typeof v !== 'string') return v;
      if (v.startsWith('data:')) return v; // inline data, nothing to sign
      const key = toStorageKey(v); // our-bucket URL -> key; external URL -> unchanged
      if (/^https?:/.test(key)) return key; // still a URL => external, leave as-is
      return presignGet(key).catch(() => v);
    })
  );
}

module.exports = { uploadPhoto, deletePhotos, presignGet, presignKeys, toStorageKey, isConfigured };
