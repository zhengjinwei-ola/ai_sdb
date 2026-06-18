import pool from '../config/db.js';
import bcrypt from 'bcryptjs';

async function migrate() {
  console.log('🔄 Starting auth and multi-tenant migration...');
  try {
    // 1. Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`username\` VARCHAR(50) NOT NULL UNIQUE,
        \`password\` VARCHAR(255) NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Created users table.');

    // 2. Create a default admin user if not exists
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin']);
    let adminId;
    if (existingUsers.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const [insertResult] = await pool.query(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        ['admin', hashedPassword]
      );
      adminId = insertResult.insertId;
      console.log('✅ Created default admin user with username "admin" and password "admin123"');
    } else {
      adminId = existingUsers[0].id;
      console.log('ℹ️ Default admin user already exists.');
    }

    // 3. Add user_id to shops if not exists
    const [columns] = await pool.query(`
      SHOW COLUMNS FROM \`shops\` LIKE 'user_id'
    `);
    if (columns.length === 0) {
      await pool.query('ALTER TABLE `shops` ADD COLUMN `user_id` INT DEFAULT NULL');
      console.log('✅ Added user_id column to shops table.');
    }

    // 4. Update existing shops to point to admin user
    await pool.query('UPDATE `shops` SET `user_id` = ? WHERE `user_id` IS NULL', [adminId]);
    console.log('✅ Assigned existing shops to admin.');

    // 5. Drop old UNIQUE index shop_code if it exists, and setup composite UNIQUE index
    const [indexes] = await pool.query('SHOW INDEX FROM `shops`');
    const hasShopCodeUnique = indexes.some(idx => idx.Key_name === 'shop_code' && !idx.Non_unique);
    const hasCompositeUnique = indexes.some(idx => idx.Key_name === 'ukey_user_shop_code');

    if (hasShopCodeUnique) {
      await pool.query('ALTER TABLE `shops` DROP INDEX `shop_code`');
      console.log('✅ Dropped old unique index on shop_code.');
    }

    if (!hasCompositeUnique) {
      // Modify column to be NOT NULL now that everything is filled
      await pool.query('ALTER TABLE `shops` MODIFY COLUMN `user_id` INT NOT NULL');
      
      // Add foreign key constraint
      try {
        await pool.query(`
          ALTER TABLE \`shops\` 
          ADD CONSTRAINT \`fk_shops_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
        `);
        console.log('✅ Added foreign key constraint on user_id.');
      } catch (err) {
        console.log('ℹ️ Foreign key might already exist:', err.message);
      }

      // Add composite UNIQUE key
      await pool.query('ALTER TABLE `shops` ADD UNIQUE KEY `ukey_user_shop_code` (`user_id`, `shop_code`)');
      console.log('✅ Added composite unique index on user_id and shop_code.');
    }

    console.log('🎉 Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
