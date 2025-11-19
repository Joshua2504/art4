const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const exifr = require('exifr');
const nodemailer = require('nodemailer');
const axios = require('axios');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/temp/' });

// ============ CONFIG ============
const CONFIG = {
  db: {
    host: process.env.DB_HOST || 'mysql',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'ruo',
    waitForConnections: true,
    connectionLimit: 10
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me',
    expiresIn: '7d'
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  },
  mailDomain: process.env.MAIL_DOMAIN || 'rechtundordnung.treudler.net',
  wegliApiKey: process.env.WEGLI_API_KEY,
  masterAccount: {
    email: process.env.MASTER_EMAIL || 'joshua@treudler.net',
    password: process.env.MASTER_PASSWORD || 'password',
    name: process.env.MASTER_NAME || 'Joshua Treudler'
  }
};

let db;

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ============ DB CONNECTION ============
async function connectDB() {
  try {
    db = await mysql.createPool(CONFIG.db);
    console.log('✅ MySQL connected');

    // Create master account if it doesn't exist
    await createMasterAccount();
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    process.exit(1);
  }
}

async function createMasterAccount() {
  try {
    const { email, password, name } = CONFIG.masterAccount;

    // Check if master account already exists
    const [users] = await db.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (users.length > 0) {
      console.log(`ℹ️  Master account already exists: ${email}`);
      return;
    }

    // Create master account
    const passwordHash = await bcrypt.hash(password, 10);
    await db.execute(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
      [email, passwordHash, name]
    );

    console.log(`✅ Master account created: ${email}`);
  } catch (error) {
    console.error('⚠️  Failed to create master account:', error.message);
  }
}

// ============ AUTH MIDDLEWARE ============
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, CONFIG.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ UTILITIES ============
function generateCaseNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `RUO-${year}${month}-${random}`;
}

function getCaseEmailAddress(caseNumber) {
  return `${caseNumber.toLowerCase()}@${CONFIG.mailDomain}`;
}

async function geocodeLocation(lat, lng) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat,
        lon: lng,
        format: 'json',
        addressdetails: 1,
        'accept-language': 'de'
      },
      headers: { 'User-Agent': 'RUO-Platform/1.0' }
    });

    const { address, display_name } = response.data;
    return {
      address: display_name,
      zip: address.postcode || null,
      city: address.city || address.town || address.village || null
    };
  } catch (error) {
    console.error('Geocoding error:', error.message);
    return null;
  }
}

async function getDistrictByZip(zip) {
  if (!zip || !CONFIG.wegliApiKey) {
    console.log('No ZIP or weg.li API key, skipping district lookup');
    return null;
  }

  try {
    // Check cache first
    const [cached] = await db.execute(
      'SELECT * FROM districts WHERE zip = ?',
      [zip]
    );

    if (cached[0]) {
      console.log(`Using cached district for ZIP ${zip}`);
      return cached[0];
    }

    // Fetch from weg.li API
    console.log(`Fetching district for ZIP ${zip} from weg.li API`);
    const response = await axios.get(`https://www.weg.li/api/districts/${zip}`, {
      headers: {
        'X-API-KEY': CONFIG.wegliApiKey,
        'Accept': 'application/json'
      },
      timeout: 5000
    });

    const district = response.data;

    // Cache in database
    await db.execute(
      `INSERT INTO districts (name, zip, email, latitude, longitude, personal_email)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       email = VALUES(email),
       latitude = VALUES(latitude),
       longitude = VALUES(longitude),
       personal_email = VALUES(personal_email)`,
      [
        district.name,
        district.zip,
        district.email,
        district.latitude || null,
        district.longitude || null,
        district.personal_email || false
      ]
    );

    const [newDistrict] = await db.execute(
      'SELECT * FROM districts WHERE zip = ?',
      [zip]
    );

    console.log(`✅ District cached: ${district.name} (${district.email})`);
    return newDistrict[0];
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`No district found for ZIP ${zip}`);
      return null;
    }
    console.error('weg.li API error:', error.message);
    return null;
  }
}

// ============ API ENDPOINTS ============

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- AUTH ----
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
      [email, passwordHash, name || null]
    );

    const token = jwt.sign(
      { id: result.insertId, email },
      CONFIG.jwt.secret,
      { expiresIn: CONFIG.jwt.expiresIn }
    );

    res.json({
      token,
      user: { id: result.insertId, email, name: name || null }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (!users[0]) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      CONFIG.jwt.secret,
      { expiresIn: CONFIG.jwt.expiresIn }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, email, name, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!users[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ---- REPORTS ----
app.post('/api/reports', authMiddleware, async (req, res) => {
  try {
    const caseNumber = generateCaseNumber();

    const [result] = await db.execute(
      'INSERT INTO reports (case_number, user_id, status) VALUES (?, ?, "draft")',
      [caseNumber, req.user.id]
    );

    res.json({
      id: result.insertId,
      caseNumber,
      status: 'draft'
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const [reports] = await db.execute(
      `SELECT r.*,
              (SELECT COUNT(*) FROM photos WHERE report_id = r.id) as photo_count
       FROM reports r
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    res.json({ reports });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

app.get('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    const [reports] = await db.execute(
      'SELECT * FROM reports WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!reports[0]) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const [photos] = await db.execute(
      'SELECT id, filename, filepath, lat, lng, taken_at, created_at FROM photos WHERE report_id = ?',
      [req.params.id]
    );

    const [documents] = await db.execute(
      'SELECT * FROM documents WHERE report_id = ?',
      [req.params.id]
    );

    const [history] = await db.execute(
      'SELECT * FROM status_history WHERE report_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      report: reports[0],
      photos,
      documents,
      history
    });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: 'Failed to get report' });
  }
});

app.put('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    const { violationType, notes, isPublic, hideUsername } = req.body;

    // Verify ownership
    const [reports] = await db.execute(
      'SELECT * FROM reports WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!reports[0]) {
      return res.status(404).json({ error: 'Report not found' });
    }

    await db.execute(
      'UPDATE reports SET violation_type = ?, notes = ?, is_public = ?, hide_username = ? WHERE id = ?',
      [violationType || null, notes || null, isPublic !== undefined ? isPublic : true, hideUsername || false, req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

app.put('/api/reports/:id/location', authMiddleware, async (req, res) => {
  try {
    const { lat, lng, address, zip } = req.body;

    // Verify ownership
    const [reports] = await db.execute(
      'SELECT * FROM reports WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!reports[0]) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Get district from weg.li if we have a zip
    let districtId = null;
    if (zip) {
      const district = await getDistrictByZip(zip);
      if (district) {
        districtId = district.id;
        console.log(`✅ District updated: ${district.name} → ${district.email}`);
      }
    }

    await db.execute(
      'UPDATE reports SET location_lat = ?, location_lng = ?, location_address = ?, location_zip = ?, district_id = ? WHERE id = ?',
      [lat, lng, address || null, zip || null, districtId, req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

app.delete('/api/reports/:id', authMiddleware, async (req, res) => {
  try {
    // Get report details
    const [reports] = await db.execute(
      'SELECT * FROM reports WHERE id = ? AND user_id = ? AND status = "draft"',
      [req.params.id, req.user.id]
    );

    if (!reports[0]) {
      return res.status(404).json({ error: 'Report not found or cannot be deleted' });
    }

    const report = reports[0];

    // Get all photos for this report
    const [photos] = await db.execute(
      'SELECT filepath FROM photos WHERE report_id = ?',
      [req.params.id]
    );

    // Delete the report (photos will be deleted by CASCADE)
    await db.execute(
      'DELETE FROM reports WHERE id = ?',
      [req.params.id]
    );

    // Delete physical files
    for (const photo of photos) {
      try {
        await fs.unlink(photo.filepath);
      } catch (err) {
        console.error(`Failed to delete file ${photo.filepath}:`, err.message);
      }
    }

    // Delete the report directory if it exists
    const photoDir = path.join('uploads', report.case_number);
    try {
      await fs.rmdir(photoDir);
    } catch (err) {
      // Directory might not be empty or doesn't exist, ignore
      console.log(`Could not remove directory ${photoDir}:`, err.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// ---- PHOTOS ----
app.post('/api/photos', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const { reportId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify report ownership
    const [reports] = await db.execute(
      'SELECT * FROM reports WHERE id = ? AND user_id = ?',
      [reportId, req.user.id]
    );

    if (!reports[0]) {
      await fs.unlink(file.path);
      return res.status(404).json({ error: 'Report not found' });
    }

    const report = reports[0];

    // Determine if it's a photo or video
    const isVideo = file.mimetype.startsWith('video/');
    const mediaType = isVideo ? 'video' : 'photo';

    // Extract EXIF (only for photos)
    let lat = null, lng = null, takenAt = null;
    if (!isVideo) {
      try {
        const exif = await exifr.parse(file.path, { gps: true });
        lat = exif?.latitude || null;
        lng = exif?.longitude || null;
        takenAt = exif?.DateTimeOriginal || null;
      } catch (exifError) {
        console.log('EXIF extraction failed:', exifError.message);
      }
    }

    // Move file to permanent location
    const photoDir = path.join('uploads', report.case_number);
    await fs.mkdir(photoDir, { recursive: true });
    const newPath = path.join(photoDir, `${Date.now()}-${file.originalname}`);
    await fs.rename(file.path, newPath);

    // Save to DB
    await db.execute(
      'INSERT INTO photos (report_id, filename, filepath, mime_type, media_type, file_size, lat, lng, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [reportId, file.originalname, newPath, file.mimetype, mediaType, file.size, lat, lng, takenAt]
    );

    // Prepare response data
    const responseData = {
      success: true,
      photo: {
        lat,
        lng,
        mediaType
      }
    };

    // Update report location if this is first photo with GPS
    if (lat && lng && !report.location_lat) {
      // Geocode
      const location = await geocodeLocation(lat, lng);

      // Get district from weg.li
      let districtId = null;
      if (location?.zip) {
        const district = await getDistrictByZip(location.zip);
        if (district) {
          districtId = district.id;
          console.log(`✅ District assigned: ${district.name} → ${district.email}`);
        }
      }

      await db.execute(
        'UPDATE reports SET location_lat = ?, location_lng = ?, location_address = ?, location_zip = ?, district_id = ? WHERE id = ?',
        [lat, lng, location?.address || null, location?.zip || null, districtId, reportId]
      );

      // Add location to response
      responseData.location = {
        address: location?.address || null,
        zip: location?.zip || null,
        lat,
        lng
      };

      // 🚨 PROXIMITY CHECK (50m)
      const [nearby] = await db.execute(
        `SELECT id, case_number, status,
                ST_Distance_Sphere(
                  POINT(location_lng, location_lat),
                  POINT(?, ?)
                ) as distance
         FROM reports
         WHERE location_lat IS NOT NULL
           AND id != ?
         HAVING distance <= 50
         ORDER BY distance
         LIMIT 10`,
        [lng, lat, reportId]
      );

      if (nearby.length > 0) {
        responseData.proximityWarning = {
          found: true,
          count: nearby.length,
          reports: nearby.map(r => ({
            caseNumber: r.case_number,
            distance: Math.round(r.distance),
            status: r.status
          }))
        };
      }
    } else if (lat && lng) {
      // Photo has GPS but report already has location
      // Geocode this photo's location
      const location = await geocodeLocation(lat, lng);
      responseData.location = {
        address: location?.address || null,
        zip: location?.zip || null,
        lat,
        lng
      };
    }

    res.json(responseData);
  } catch (error) {
    console.error('Photo upload error:', error);
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// ---- SUBMIT REPORT ----
app.post('/api/reports/:id/submit', authMiddleware, async (req, res) => {
  try {
    // Get report
    const [reports] = await db.execute(
      'SELECT * FROM reports WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!reports[0]) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const report = reports[0];

    if (report.status !== 'draft') {
      return res.status(400).json({ error: 'Report already submitted' });
    }

    // Get photos
    const [photos] = await db.execute(
      'SELECT * FROM photos WHERE report_id = ?',
      [req.params.id]
    );

    if (photos.length === 0) {
      return res.status(400).json({ error: 'Please upload at least one photo' });
    }

    // Get district email
    let districtEmail = null;
    let districtName = null;
    if (report.district_id) {
      const [districts] = await db.execute(
        'SELECT name, email FROM districts WHERE id = ?',
        [report.district_id]
      );
      if (districts[0] && districts[0].email) {
        districtEmail = districts[0].email;
        districtName = districts[0].name;
      }
    }

    // Fallback if no district found
    if (!districtEmail) {
      return res.status(400).json({
        error: 'No district found',
        message: 'Kein zuständiges Ordnungsamt gefunden. Bitte Standortinformationen überprüfen.'
      });
    }

    // Generate email address
    const emailAddress = getCaseEmailAddress(report.case_number);

    // Send email
    try {
      const transporter = nodemailer.createTransport(CONFIG.smtp);

      const attachments = photos.map(photo => ({
        filename: photo.filename,
        path: photo.filepath
      }));

      await transporter.sendMail({
        from: `"RechtUndOrdnung" <${emailAddress}>`,
        to: districtEmail,
        replyTo: emailAddress,
        subject: `DSGVO-Verstoß - Aktenzeichen ${report.case_number}`,
        text: `
Sehr geehrte Damen und Herren,

hiermit melde ich einen DSGVO-Verstoß im Bereich Videoüberwachung.

Aktenzeichen: ${report.case_number}
Standort: ${report.location_address || 'Keine Adresse verfügbar'}
Verstoß: ${report.violation_type || 'Nicht angegeben'}

${report.notes || ''}

Fotos im Anhang.

Mit freundlichen Grüßen
Diese E-Mail wurde automatisch generiert von rechtundordnung.de
        `.trim(),
        attachments
      });

      // Update report
      await db.execute(
        'UPDATE reports SET status = "submitted", submitted_at = NOW() WHERE id = ?',
        [req.params.id]
      );

      // Log email
      await db.execute(
        'INSERT INTO email_logs (report_id, direction, from_email, to_email, subject, body) VALUES (?, "outbound", ?, ?, ?, ?)',
        [req.params.id, emailAddress, 'ordnungsamt@example.com', `DSGVO-Verstoß - ${report.case_number}`, report.notes || '']
      );

      res.json({ success: true, message: 'Report submitted successfully' });
    } catch (emailError) {
      console.error('Email send error:', emailError);
      res.status(500).json({ error: 'Failed to send email' });
    }
  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// ---- PUBLIC API ----
app.get('/api/public/reports', async (req, res) => {
  try {
    const [reports] = await db.execute(
      `SELECT r.case_number, r.violation_type, r.notes, r.location_address, r.location_zip,
              r.location_lat, r.location_lng, r.status, r.submitted_at, r.created_at,
              r.hide_username,
              CASE WHEN r.hide_username = TRUE THEN NULL ELSE u.name END as user_name,
              CASE WHEN r.hide_username = TRUE THEN NULL ELSE u.email END as user_email,
              (SELECT COUNT(*) FROM photos WHERE report_id = r.id) as photo_count
       FROM reports r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.is_public = TRUE AND r.status != 'draft'
       ORDER BY r.submitted_at DESC
       LIMIT 100`
    );

    res.json({ reports });
  } catch (error) {
    console.error('Get public reports error:', error);
    res.status(500).json({ error: 'Failed to get public reports' });
  }
});

app.get('/api/public/reports/:caseNumber', async (req, res) => {
  try {
    const [reports] = await db.execute(
      `SELECT r.id, r.case_number, r.violation_type, r.notes, r.location_address,
              r.location_zip, r.status, r.submitted_at, r.hide_username,
              CASE WHEN r.hide_username = TRUE THEN NULL ELSE u.name END as user_name,
              CASE WHEN r.hide_username = TRUE THEN NULL ELSE u.email END as user_email
       FROM reports r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.case_number = ? AND r.is_public = TRUE`,
      [req.params.caseNumber]
    );

    if (!reports[0]) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const [photos] = await db.execute(
      'SELECT id, filename, filepath, media_type, mime_type FROM photos WHERE report_id = ?',
      [reports[0].id]
    );

    res.json({
      report: reports[0],
      photos
    });
  } catch (error) {
    console.error('Get public report error:', error);
    res.status(500).json({ error: 'Failed to get report' });
  }
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║  RechtUndOrdnung Platform                    ║
║  Server running on http://localhost:${PORT}     ║
╚═══════════════════════════════════════════════╝
    `);
  });
});
