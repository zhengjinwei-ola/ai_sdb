import { exec } from 'child_process';
import db from '../config/db.js';
import path from 'path';

function runParser() {
  return new Promise((resolve, reject) => {
    const pyPath = path.join(process.cwd(), '../.venv/bin/python3');
    const scriptPath = path.join(process.cwd(), 'scripts/parse_history_files.py');
    
    exec(`${pyPath} ${scriptPath}`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Python Parser Error stderr:', stderr);
        return reject(error);
      }
      try {
        const data = JSON.parse(stdout);
        resolve(data);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function main() {
  console.log('🌱 Starting comprehensive history import...');
  
  try {
    const data = await runParser();
    const periods = Object.keys(data).sort(); // Sort chronologically (e.g., 2025-09, 2025-10... 2026-06)
    
    if (periods.length === 0) {
      console.log('⚠️ No historical Excel files found.');
      await db.end();
      return;
    }
    
    console.log(`Found history for ${periods.length} periods:`, periods.join(', '));
    
    // Clear existing tables to ensure clean, consistent data across all months
    console.log('Clearing existing tables...');
    await db.query('DELETE FROM shops'); // Foreign Key cascades will clear meters and readings
    console.log('Tables cleared.');
    
    // Cache map to preserve IDs across monthly iterations
    const shopCodeToId = {};  // shopCode -> shopId
    const meterKeyToId = {};  // "shopId:type:name" -> meterId
    
    for (const period of periods) {
      console.log(`Importing period: ${period} ...`);
      const shopsData = data[period];
      
      for (const s of shopsData) {
        let shopId = shopCodeToId[s.shop_code];
        
        // 1. Create shop if it doesn't exist
        if (!shopId) {
          const [shopResult] = await db.query(
            'INSERT INTO shops (shop_code, shop_name, labor_fee, rubbish_fee) VALUES (?, ?, ?, ?)',
            [s.shop_code, s.shop_name, s.labor_fee, s.rubbish_fee]
          );
          shopId = shopResult.insertId;
          shopCodeToId[s.shop_code] = shopId;
        } else {
          // If shop already exists, update name/fees to the latest month's configuration
          await db.query(
            'UPDATE shops SET shop_name = ?, labor_fee = ?, rubbish_fee = ? WHERE id = ?',
            [s.shop_name, s.labor_fee, s.rubbish_fee, shopId]
          );
        }
        
        // 2. Create meters and insert readings
        for (const m of s.meters) {
          if (!m) continue;
          
          const meterKey = `${shopId}:${m.type}:${m.name}`;
          let meterId = meterKeyToId[meterKey];
          
          if (!meterId) {
            const createdAtStr = `${period}-01 00:00:00`;
            const [meterResult] = await db.query(
              'INSERT INTO meters (shop_id, meter_type, meter_name, unit_price, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
              [shopId, m.type, m.name, m.unit_price, createdAtStr]
            );
            meterId = meterResult.insertId;
            meterKeyToId[meterKey] = meterId;
          }
          
          // 3. Insert historical reading
          const previousReading = m.previous !== null ? parseFloat(m.previous) : 0.0;
          const currentReading = m.current !== null ? parseFloat(m.current) : null;
          
          await db.query(
            'INSERT INTO meter_readings (meter_id, billing_period, previous_reading, current_reading, reading_date, status) VALUES (?, ?, ?, ?, ?, ?)',
            [
              meterId,
              period,
              previousReading,
              currentReading,
              currentReading !== null ? new Date() : null,
              currentReading !== null ? 'completed' : 'pending'
            ]
          );
        }
      }
    }
    
    console.log('✅ ALL historical periods successfully imported & synchronized into MySQL!');
  } catch (error) {
    console.error('❌ Historical import failed:', error);
  } finally {
    await db.end();
  }
}

main();
