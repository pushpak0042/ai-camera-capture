const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 4000;

// Supabase configuration
const SUPABASE_URL = 'https://rlcugffovfozbckbbkqt.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const SUPABASE_DB_URL = 'postgresql://postgres:[YOUR-PASSWORD]@db.rlcugffovfozbckbbkqt.supabase.co:5432/postgres';
const SUPABASE_CLI_SETUP = [
  'supabase login',
  'supabase init',
  'supabase link --project-ref rlcugffovfozbckbbkqt',
];

// Create captures directory if it doesn't exist
const capturesDir = path.join(__dirname, 'captures');
if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

// Parse JSON bodies (for base64 image data from frontend)
app.use(express.json({ limit: '10mb' }));

// Trust proxy for visitor IP
app.set('trust proxy', true);

// Serve static files (HTML, CSS, JS)
app.use(express.static(__dirname));

// POST /save-capture — receive base64 image, save to disk, and log metadata to Supabase
app.post('/save-capture', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'No image data received' });
  }

  // Extract base64 data (remove data:image/jpeg;base64, prefix)
  const matches = image.match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: 'Invalid image format' });
  }

  const ext = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `capture_${timestamp}.${ext}`;
  const filepath = path.join(capturesDir, filename);

  // Save to local disk
  fs.writeFile(filepath, buffer, async (err) => {
    if (err) {
      console.error('Error saving capture:', err);
      return res.status(500).json({ error: 'Failed to save capture' });
    }

    console.log(`📷 Capture saved: ${filename}`);

    try {
      const payload = {
        filename,
        created_at: new Date().toISOString(),
        image_path: `/captures/${filename}`,
        ip_address: req.ip || 'Unknown',
        user_agent: req.get('User-Agent') || 'Unknown',
      };

      const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (supabaseRes.ok) {
        console.log(`🗄️ Capture metadata stored in Supabase: ${filename}`);
      } else {
        const errorText = await supabaseRes.text();
        console.warn(`⚠️ Supabase insert failed (${supabaseRes.status}): ${errorText}`);
      }
    } catch (supabaseErr) {
      console.warn(`⚠️ Supabase connection error: ${supabaseErr.message}`);
    }

    res.json({
      success: true,
      filename,
      supabase: {
        url: SUPABASE_URL,
        configured: Boolean(SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'),
      },
    });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Solve It server running at http://localhost:${PORT}`);
  console.log(`📁 Captures saved to: ${capturesDir}`);
  console.log(`�️ Supabase project: ${SUPABASE_URL}`);
  console.log(`🧰 Supabase CLI setup: ${SUPABASE_CLI_SETUP.join(' | ')}`);
});
