require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 4000;

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'camera-captures';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

const supabase = SUPABASE_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const capturesDir = path.join(__dirname, 'captures');
if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));
app.set('trust proxy', true);
app.use(express.static(__dirname));

function listCaptureFiles() {
  return fs.readdirSync(capturesDir)
    .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
    .sort()
    .map((file) => ({
      filename: file,
      url: `/captures/${file}`,
      createdAt: fs.statSync(path.join(capturesDir, file)).mtime,
    }));
}

async function uploadToSupabaseStorage(filename, buffer, contentType) {
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const bucketResult = await supabase.storage.createBucket(SUPABASE_BUCKET, { public: true });
  if (bucketResult.error && !bucketResult.error.message.includes('already exists')) {
    console.warn(`⚠️ Could not ensure bucket exists: ${bucketResult.error.message}`);
  }

  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filename, buffer, {
    contentType,
    upsert: true,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const signedUrlResult = await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(filename, 60 * 60 * 24);
  const publicUrl = signedUrlResult.data?.signedUrl || null;
  return { ok: true, data, publicUrl };
}

app.get('/gallery', (req, res) => {
  const files = listCaptureFiles();
  const rows = files.map((item) => `<li><a href="${item.url}" target="_blank">${item.filename}</a></li>`).join('');
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Captured Images</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;}img{max-width:320px;display:block;margin-top:12px;border-radius:10px;}</style>
  </head>
  <body>
    <h1>Captured Images</h1>
    <p>Images are stored locally in the captures folder and can also be opened directly from the links below.</p>
    <ul>${rows || '<li>No captures yet.</li>'}</ul>
  </body>
</html>`;
  res.send(html);
});

app.post('/save-capture', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'No image data received' });
  }

  const matches = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: 'Invalid image format' });
  }

  const ext = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `capture_${timestamp}.${ext}`;
  const filepath = path.join(capturesDir, filename);

  try {
    fs.writeFileSync(filepath, buffer);
    console.log(`📷 Capture saved locally: ${filename}`);
  } catch (err) {
    console.error('Error saving capture:', err);
    return res.status(500).json({ error: 'Failed to save capture' });
  }

  let supabaseResult = null;
  if (SUPABASE_ENABLED) {
    try {
      const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      supabaseResult = await uploadToSupabaseStorage(filename, buffer, contentType);
      if (supabaseResult.ok) {
        console.log(`☁️ Capture uploaded to Supabase storage: ${filename}`);
      } else {
        console.warn(`⚠️ Supabase upload failed: ${supabaseResult.error}`);
      }
    } catch (supabaseErr) {
      console.warn(`⚠️ Supabase connection error: ${supabaseErr.message}`);
    }
  }

  const imageUrl = `${req.protocol}://${req.get('host')}/captures/${filename}`;

  res.json({
    success: true,
    filename,
    imageUrl,
    localPath: filepath,
    supabase: {
      enabled: SUPABASE_ENABLED,
      bucket: SUPABASE_BUCKET,
      publicUrl: supabaseResult?.publicUrl || null,
      error: supabaseResult?.error || null,
    },
  });
});

app.get('/api/captures', (req, res) => {
  res.json(listCaptureFiles());
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Solve It server running at http://localhost:${PORT}`);
  console.log(`📁 Captures saved to: ${capturesDir}`);
  console.log(`🖼️ Open http://localhost:${PORT}/gallery to view saved images`);
  console.log(`☁️ Supabase upload enabled: ${SUPABASE_ENABLED}`);
  if (SUPABASE_ENABLED) {
    console.log(`🧳 Supabase storage bucket: ${SUPABASE_BUCKET}`);
  }
});
