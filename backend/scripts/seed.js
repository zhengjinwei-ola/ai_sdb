import { exec } from 'child_process';
import db from '../config/db.js';
import path from 'path';

function runExtractor() {
  return new Promise((resolve, reject) => {
    // Use the virtual environment python interpreter to run the script
    const pyPath = path.join(process.cwd(), '../.venv/bin/python3');
    const scriptPath = path.join(process.cwd(), 'scripts/extract_xlsx.py');
    
    exec(`${pyPath} ${scriptPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error('Python Extractor Error stderr:', stderr);
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
  console.log('🌱 Starting database seeding from 26年6月抄表.xlsx...');
  
  try {
    const data = await runExtractor();
    console.log(`Successfully extracted ${data.length} shops from Excel.`);
    
    // Clear old data (Foreign Key ON DELETE CASCADE will handle meters and readings)
    console.log('Cleaning existing tables...');
    await db.query('DELETE FROM shops');
    console.log('Tables cleared.');
    
    const billingPeriod = '2026-06';
    
    for (const shop of data) {
      // 1. Insert Shop
      const [shopResult] = await db.query(
        'INSERT INTO shops (shop_code, shop_name, labor_fee, rubbish_fee) VALUES (?, ?, ?, ?)',
        [shop.shop_code, shop.shop_name, shop.labor_fee, shop.rubbish_fee]
      );
      const shopId = shopResult.insertId;
      
      // 2. Insert active meters and their 2026-06 readings
      for (const m of shop.meters) {
        if (!m) continue; // Skip unused/Null meters (like unused Electricity 2 or 3)
        
        const [meterResult] = await db.query(
          'INSERT INTO meters (shop_id, meter_type, meter_name, unit_price, is_active) VALUES (?, ?, ?, ?, 1)',
          [shopId, m.type, m.name, m.unit_price]
        );
        const meterId = meterResult.insertId;
        
        // 3. Insert reading record for billing period 2026-06
        // Previous reading must be valid. If current reading is also valid, insert it.
        const previousReading = m.previous !== null ? parseFloat(m.previous) : 0.0;
        const currentReading = m.current !== null ? parseFloat(m.current) : null;
        
        await db.query(
          'INSERT INTO meter_readings (meter_id, billing_period, previous_reading, current_reading, reading_date, status) VALUES (?, ?, ?, ?, ?, ?)',
          [
            meterId,
            billingPeriod,
            previousReading,
            currentReading,
            currentReading !== null ? new Date() : null,
            currentReading !== null ? 'completed' : 'pending'
          ]
        );
      }
    }
    
    console.log('✅ Database seeded successfully with June 2026 data!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    await db.end();
  }
}

main();
