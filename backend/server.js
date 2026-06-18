import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import pool from './config/db.js';
import { exec } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'meter-billing-secret-key-2026';

// Middleware to verify JWT Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

// Helper function to subtract 1 month from YYYY-MM
function getPreviousPeriod(period) {
  const [yearStr, monthStr] = period.split('-');
  let year = parseInt(yearStr);
  let month = parseInt(monthStr);
  
  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  
  return `${year}-${String(month).padStart(2, '0')}`;
}

// --- Auth Endpoints ---

// POST /api/auth/register - Register a new user
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ error: '该用户名已被注册' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    res.status(201).json({ message: '注册成功' });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login - User login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ error: '用户名或密码不正确' });
    }
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码不正确' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1. GET /api/shops - List all shops with meter count, completed readings, and full meters list
app.get('/api/shops', authenticateToken, async (req, res) => {
  const { period } = req.query;
  try {
    let query;
    let params = [];
    if (period) {
      query = `
        SELECT s.*, 
               COALESCE(m.meter_count, 0) as meter_count,
               COALESCE(r.completed_count, 0) as completed_count
        FROM shops s
        LEFT JOIN (
          SELECT shop_id, COUNT(*) as meter_count 
          FROM meters 
          WHERE is_active = 1 AND DATE_FORMAT(created_at, '%Y-%m') <= ?
          GROUP BY shop_id
        ) m ON s.id = m.shop_id
        LEFT JOIN (
          SELECT m.shop_id, COUNT(mr.id) as completed_count
          FROM meters m
          JOIN meter_readings mr ON m.id = mr.meter_id
          WHERE mr.billing_period = ? AND mr.current_reading IS NOT NULL
          GROUP BY m.shop_id
        ) r ON s.id = r.shop_id
        WHERE s.user_id = ?
        ORDER BY CAST(s.shop_code AS UNSIGNED), s.shop_code;
      `;
      params.push(period, period, req.user.id);
    } else {
      query = `
        SELECT s.*, 
               COALESCE(m.meter_count, 0) as meter_count,
               0 as completed_count
        FROM shops s
        LEFT JOIN (
          SELECT shop_id, COUNT(*) as meter_count 
          FROM meters 
          WHERE is_active = 1 
          GROUP BY shop_id
        ) m ON s.id = m.shop_id
        WHERE s.user_id = ?
        ORDER BY CAST(s.shop_code AS UNSIGNED), s.shop_code;
      `;
      params.push(req.user.id);
    }
    const [shops] = await pool.query(query, params);
    
    // Fetch all meters belonging to this user's shops
    const [meters] = await pool.query(
      'SELECT m.* FROM meters m JOIN shops s ON m.shop_id = s.id WHERE s.user_id = ? ORDER BY m.id',
      [req.user.id]
    );
    
    // Group meters by shop_id
    const metersMap = {};
    for (const m of meters) {
      if (!metersMap[m.shop_id]) {
        metersMap[m.shop_id] = [];
      }
      metersMap[m.shop_id].push(m);
    }
    
    // Append meters to each shop
    const result = shops.map(s => ({
      ...s,
      metersList: metersMap[s.id] || []
    }));
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching shops:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/shops - Add new shop
app.post('/api/shops', authenticateToken, async (req, res) => {
  const { shopCode, shopName, laborFee, rubbishFee } = req.body;
  if (!shopCode || !shopName) {
    return res.status(400).json({ error: 'Shop code and name are required' });
  }
  try {
    // Check code uniqueness for this user
    const [existing] = await pool.query('SELECT id FROM shops WHERE user_id = ? AND shop_code = ?', [req.user.id, shopCode]);
    if (existing.length > 0) {
      return res.status(400).json({ error: `该编号的商铺 ${shopCode} 已存在` });
    }

    const [result] = await pool.query(
      'INSERT INTO shops (shop_code, shop_name, labor_fee, rubbish_fee, user_id) VALUES (?, ?, ?, ?, ?)',
      [shopCode, shopName, laborFee || 0, rubbishFee || 0, req.user.id]
    );
    res.status(201).json({ id: result.insertId, shopCode, shopName, laborFee, rubbishFee });
  } catch (error) {
    console.error('Error creating shop:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/shops/:id/meters - Add new meter to shop
app.post('/api/shops/:id/meters', authenticateToken, async (req, res) => {
  const shopId = req.params.id;
  const { meterType, meterName, unitPrice } = req.body;
  if (!meterType || !meterName || unitPrice === undefined) {
    return res.status(400).json({ error: 'meterType, meterName, and unitPrice are required' });
  }
  try {
    // Verify shop ownership
    const [shop] = await pool.query('SELECT id FROM shops WHERE id = ? AND user_id = ?', [shopId, req.user.id]);
    if (shop.length === 0) {
      return res.status(403).json({ error: 'Access denied or shop not found.' });
    }

    const [result] = await pool.query(
      'INSERT INTO meters (shop_id, meter_type, meter_name, unit_price, is_active) VALUES (?, ?, ?, ?, 1)',
      [shopId, meterType, meterName, unitPrice]
    );
    res.status(201).json({ id: result.insertId, shopId, meterType, meterName, unitPrice });
  } catch (error) {
    console.error('Error creating meter:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. PUT /api/meters/:id - Edit meter (modify price or deactivate)
app.put('/api/meters/:id', authenticateToken, async (req, res) => {
  const meterId = req.params.id;
  const { unitPrice, isActive } = req.body;
  try {
    // Verify meter ownership through shop ownership
    const [shop] = await pool.query(
      'SELECT s.id FROM shops s JOIN meters m ON s.id = m.shop_id WHERE m.id = ? AND s.user_id = ?',
      [meterId, req.user.id]
    );
    if (shop.length === 0) {
      return res.status(403).json({ error: 'Access denied or meter not found.' });
    }

    let updateFields = [];
    let params = [];
    if (unitPrice !== undefined) {
      updateFields.push('unit_price = ?');
      params.push(unitPrice);
    }
    if (isActive !== undefined) {
      updateFields.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(meterId);
    await pool.query(
      `UPDATE meters SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    res.json({ message: 'Meter updated successfully' });
  } catch (error) {
    console.error('Error updating meter:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. GET /api/shops/:id/readings - Get readings for shop in period (with carry-over logic)
app.get('/api/shops/:id/readings', authenticateToken, async (req, res) => {
  const shopId = req.params.id;
  const { period } = req.query; // YYYY-MM, e.g., '2026-06'
  
  if (!period) {
    return res.status(400).json({ error: 'Period parameter is required' });
  }
  
  try {
    // Verify shop ownership
    const [shop] = await pool.query('SELECT id FROM shops WHERE id = ? AND user_id = ?', [shopId, req.user.id]);
    if (shop.length === 0) {
      return res.status(403).json({ error: 'Access denied or shop not found.' });
    }

    // A. Query active meters for the shop that existed during or before this period
    const [meters] = await pool.query(
      "SELECT id, meter_type, meter_name, unit_price, created_at FROM meters WHERE shop_id = ? AND is_active = 1 AND DATE_FORMAT(created_at, '%Y-%m') <= ?",
      [shopId, period]
    );
    
    const results = [];
    const prevPeriod = getPreviousPeriod(period);
    
    for (const m of meters) {
      // B. Check if reading already exists for this period
      const [readings] = await pool.query(
        'SELECT id, previous_reading, current_reading, status FROM meter_readings WHERE meter_id = ? AND billing_period = ?',
        [m.id, period]
      );
      
      if (readings.length > 0) {
        results.push({
          meterId: m.id,
          meterType: m.meter_type,
          meterName: m.meter_name,
          unitPrice: m.unit_price,
          previousReading: parseFloat(readings[0].previous_reading),
          currentReading: readings[0].current_reading !== null ? parseFloat(readings[0].current_reading) : null,
          status: readings[0].status
        });
      } else {
        // C. No record exists yet -> Execute Carry-Over Logic
        // Find previous period's current reading
        const [prevReadings] = await pool.query(
          'SELECT current_reading FROM meter_readings WHERE meter_id = ? AND billing_period = ?',
          [m.id, prevPeriod]
        );
        
        let previousReading = 0.0;
        if (prevReadings.length > 0 && prevReadings[0].current_reading !== null) {
          previousReading = parseFloat(prevReadings[0].current_reading);
        }
        
        results.push({
          meterId: m.id,
          meterType: m.meter_type,
          meterName: m.meter_name,
          unitPrice: m.unit_price,
          previousReading: previousReading,
          currentReading: null,
          status: 'pending'
        });
      }
    }
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching readings:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. POST /api/readings/bulk - Submit bulk readings for a period
app.post('/api/readings/bulk', authenticateToken, async (req, res) => {
  const { period, readings } = req.body; // readings: Array of { meterId, previousReading, currentReading }
  if (!period || !readings || !Array.isArray(readings)) {
    return res.status(400).json({ error: 'period and readings (array) are required' });
  }
  
  try {
    // Get all meter IDs belonging to this user's shops
    const [userMeters] = await pool.query(
      'SELECT m.id FROM meters m JOIN shops s ON m.shop_id = s.id WHERE s.user_id = ?',
      [req.user.id]
    );
    const userMeterIds = new Set(userMeters.map(m => m.id));

    for (const r of readings) {
      const { meterId, previousReading, currentReading } = r;
      if (meterId === undefined || previousReading === undefined || currentReading === undefined) {
        continue;
      }
      
      // Verify this meter belongs to the logged-in user
      if (!userMeterIds.has(meterId)) {
        continue; // skip unauthorized meter readings
      }

      const parsedCurrent = currentReading === null || currentReading === '' ? null : parseFloat(currentReading);
      const parsedPrev = parseFloat(previousReading);
      
      // Check if entry already exists
      const [existing] = await pool.query(
        'SELECT id FROM meter_readings WHERE meter_id = ? AND billing_period = ?',
        [meterId, period]
      );
      
      if (existing.length > 0) {
        // Update
        await pool.query(
          'UPDATE meter_readings SET previous_reading = ?, current_reading = ?, reading_date = ?, status = ? WHERE id = ?',
          [
            parsedPrev,
            parsedCurrent,
            parsedCurrent !== null ? new Date() : null,
            parsedCurrent !== null ? 'completed' : 'pending',
            existing[0].id
          ]
        );
      } else {
        // Insert
        await pool.query(
          'INSERT INTO meter_readings (meter_id, billing_period, previous_reading, current_reading, reading_date, status) VALUES (?, ?, ?, ?, ?, ?)',
          [
            meterId,
            period,
            parsedPrev,
            parsedCurrent,
            parsedCurrent !== null ? new Date() : null,
            parsedCurrent !== null ? 'completed' : 'pending'
          ]
        );
      }
    }
    res.json({ message: 'Readings saved successfully' });
  } catch (error) {
    console.error('Error saving readings:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. POST /api/export/pdf - Export current readings of the period to PDF notices
app.post('/api/export/pdf', authenticateToken, async (req, res) => {
  const { period } = req.body; // e.g. '2026-06'
  if (!period) {
    return res.status(400).json({ error: 'period is required' });
  }
  
  try {
    // A. Query all shops, their active meters, and readings for this period belonging to this user
    const query = `
      SELECT s.id as shop_id, s.shop_code, s.shop_name, s.labor_fee, s.rubbish_fee,
             m.id as meter_id, m.meter_type, m.meter_name, m.unit_price,
             mr.previous_reading, mr.current_reading
      FROM shops s
      JOIN meters m ON s.id = m.shop_id AND m.is_active = 1
      LEFT JOIN meter_readings mr ON m.id = mr.meter_id AND mr.billing_period = ?
      WHERE s.user_id = ?
      ORDER BY CAST(s.shop_code AS UNSIGNED), s.shop_code, m.id;
    `;
    const [rows] = await pool.query(query, [period, req.user.id]);
    
    // Check if there are any incomplete readings (current_reading is null)
    const incompleteRows = rows.filter(row => row.current_reading === null);
    if (incompleteRows.length > 0) {
      const incompleteShopNames = [...new Set(incompleteRows.map(r => r.shop_name))].join('、');
      return res.status(400).json({ 
        error: '还有未完成的抄表记录，无法生成 PDF 账单！', 
        details: `未完成录入的店铺：${incompleteShopNames}。请确保所有店铺的水电表底数均已录入。` 
      });
    }
    
    // Group by shop
    const shopsMap = {};
    for (const row of rows) {
      if (!shopsMap[row.shop_id]) {
        shopsMap[row.shop_id] = {
          shop_code: row.shop_code,
          shop_name: row.shop_name,
          labor_fee: parseFloat(row.labor_fee),
          rubbish_fee: parseFloat(row.rubbish_fee),
          meters: []
        };
      }
      shopsMap[row.shop_id].meters.push({
        meter_type: row.meter_type,
        meter_name: row.meter_name,
        unit_price: parseFloat(row.unit_price),
        previous_reading: row.previous_reading !== null ? parseFloat(row.previous_reading) : 0.0,
        current_reading: row.current_reading !== null ? parseFloat(row.current_reading) : null
      });
    }
    
    const shopsList = Object.values(shopsMap);
    
    // B. Write readings to temp JSON
    const tempJsonPath = path.join(process.cwd(), 'temp_readings.json');
    writeFileSync(tempJsonPath, JSON.stringify({ period, shops: shopsList }, null, 2));
    
    // C. Execute python script to generate excel and then convert to PDF
    const pyPath = path.join(process.cwd(), '../.venv/bin/python3');
    const generatorScript = path.join(process.cwd(), 'scripts/generate_monthly_pdf.py');
    
    exec(`${pyPath} ${generatorScript} ${tempJsonPath}`, (error, stdout, stderr) => {
      // Cleanup temp JSON
      try { unlinkSync(tempJsonPath); } catch(_) {}
      
      if (error) {
        console.error('Python generator stderr:', stderr);
        return res.status(500).json({ error: 'Failed to generate PDF billing notices', details: stderr });
      }
      
      const outputPdfPath = stdout.trim();
      if (!outputPdfPath || !outputPdfPath.endsWith('.pdf')) {
        return res.status(500).json({ error: 'Python output did not yield a valid PDF path', stdout });
      }
      
      // Stream PDF back to user
      res.download(outputPdfPath, path.basename(outputPdfPath), (err) => {
        // Cleanup generated PDF after download
        try { unlinkSync(outputPdfPath); } catch(_) {}
      });
    });
    
  } catch (error) {
    console.error('Error generating PDF export:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. GET /api/reports/ledger - Get detailed compiled ledger for a period (with matching rounding math)
app.get('/api/reports/ledger', authenticateToken, async (req, res) => {
  const { period } = req.query;
  if (!period) {
    return res.status(400).json({ error: 'period parameter is required' });
  }
  
  try {
    const query = `
      SELECT s.id as shop_id, s.shop_code, s.shop_name, s.labor_fee, s.rubbish_fee,
             m.id as meter_id, m.meter_type, m.meter_name, m.unit_price,
             mr.previous_reading, mr.current_reading
      FROM shops s
      JOIN meters m ON s.id = m.shop_id AND m.is_active = 1
      LEFT JOIN meter_readings mr ON m.id = mr.meter_id AND mr.billing_period = ?
      WHERE s.user_id = ?
      ORDER BY CAST(s.shop_code AS UNSIGNED), s.shop_code, m.id;
    `;
    const [rows] = await pool.query(query, [period, req.user.id]);
    
    // Group by shop and aggregate usages
    const shopsMap = {};
    for (const row of rows) {
      if (!shopsMap[row.shop_id]) {
        shopsMap[row.shop_id] = {
          shop_id: row.shop_id,
          shop_code: row.shop_code,
          shop_name: row.shop_name,
          labor_fee: parseFloat(row.labor_fee),
          rubbish_fee: parseFloat(row.rubbish_fee),
          water_usage: 0.0,
          electricity_usage: 0.0,
          water_price: 4.13,
          electricity_price: 1.03
        };
      }
      
      const prev = row.previous_reading !== null ? parseFloat(row.previous_reading) : 0.0;
      const curr = row.current_reading !== null ? parseFloat(row.current_reading) : null;
      
      if (curr !== null) {
        const usage = Math.max(0, curr - prev);
        
        if (row.meter_type === 'water') {
          shopsMap[row.shop_id].water_usage += usage;
          shopsMap[row.shop_id].water_price = parseFloat(row.unit_price);
        } else if (row.meter_type === 'electricity') {
          shopsMap[row.shop_id].electricity_usage += usage;
          shopsMap[row.shop_id].electricity_price = parseFloat(row.unit_price);
        }
      }
    }
    
    // Compile fees following exact logic of generate_billing_pdf.py
    const shopsList = Object.values(shopsMap).map(s => {
      const water_fee = Math.floor(s.water_usage * s.water_price + 0.5);
      const electricity_fee = Math.floor(s.electricity_usage * s.electricity_price + 0.5);
      const total_fee = water_fee + electricity_fee + s.labor_fee + s.rubbish_fee;
      
      return {
        ...s,
        water_fee,
        electricity_fee,
        total_fee
      };
    });
    
    // Compute totals and grand totals
    let totalWaterFee = 0;
    let totalElecFee = 0;
    let totalLaborFee = 0;
    let totalRubbishFee = 0;
    let totalGrandFee = 0;
    
    for (const s of shopsList) {
      totalWaterFee += s.water_fee;
      totalElecFee += s.electricity_fee;
      totalLaborFee += s.labor_fee;
      totalRubbishFee += s.rubbish_fee;
      totalGrandFee += s.total_fee;
    }
    
    res.json({
      period,
      shops: shopsList,
      totals: {
        water_fee: totalWaterFee,
        electricity_fee: totalElecFee,
        labor_fee: totalLaborFee,
        rubbish_fee: totalRubbishFee,
        grand_total: totalGrandFee
      }
    });
    
  } catch (error) {
    console.error('Error compiling ledger report:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9. PUT /api/shops/:id - Edit shop details
app.put('/api/shops/:id', authenticateToken, async (req, res) => {
  const shopId = req.params.id;
  const { shopCode, shopName, laborFee, rubbishFee } = req.body;
  if (!shopCode || !shopName) {
    return res.status(400).json({ error: 'Shop code and name are required' });
  }
  try {
    // Verify ownership
    const [shop] = await pool.query('SELECT id FROM shops WHERE id = ? AND user_id = ?', [shopId, req.user.id]);
    if (shop.length === 0) {
      return res.status(403).json({ error: 'Access denied or shop not found.' });
    }
    
    // Check code uniqueness for this user
    const [existing] = await pool.query(
      'SELECT id FROM shops WHERE user_id = ? AND shop_code = ? AND id != ?',
      [req.user.id, shopCode, shopId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: `该编号的商铺 ${shopCode} 已存在` });
    }

    await pool.query(
      'UPDATE shops SET shop_code = ?, shop_name = ?, labor_fee = ?, rubbish_fee = ? WHERE id = ?',
      [shopCode, shopName, parseFloat(laborFee) || 0, parseFloat(rubbishFee) || 0, shopId]
    );
    res.json({ message: 'Shop updated successfully' });
  } catch (error) {
    console.error('Error updating shop:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10. DELETE /api/shops/:id - Delete shop (and cascade meters/readings)
app.delete('/api/shops/:id', authenticateToken, async (req, res) => {
  const shopId = req.params.id;
  try {
    // Verify ownership
    const [shop] = await pool.query('SELECT id FROM shops WHERE id = ? AND user_id = ?', [shopId, req.user.id]);
    if (shop.length === 0) {
      return res.status(403).json({ error: 'Access denied or shop not found.' });
    }
    
    await pool.query('DELETE FROM shops WHERE id = ?', [shopId]);
    res.json({ message: 'Shop deleted successfully' });
  } catch (error) {
    console.error('Error deleting shop:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Meter Billing Backend running on http://localhost:${PORT}`);
});
