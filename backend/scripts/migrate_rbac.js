import pool from '../config/db.js';

async function migrate() {
  console.log('🔄 Starting RBAC and customized PDF config migration...');
  try {
    // 1. Add 'role' to users
    const [roleCols] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'role'");
    if (roleCols.length === 0) {
      await pool.query("ALTER TABLE `users` ADD COLUMN `role` ENUM('primary', 'reader') NOT NULL DEFAULT 'primary'");
      console.log('✅ Added role column to users table.');
    } else {
      console.log('ℹ️ role column already exists.');
    }

    // 2. Add 'parent_id' to users
    const [parentCols] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'parent_id'");
    if (parentCols.length === 0) {
      await pool.query("ALTER TABLE `users` ADD COLUMN `parent_id` INT DEFAULT NULL");
      console.log('✅ Added parent_id column to users table.');
      
      // Add foreign key constraint
      try {
        await pool.query(`
          ALTER TABLE \`users\`
          ADD CONSTRAINT \`fk_users_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
        `);
        console.log('✅ Added foreign key constraint fk_users_parent on users(parent_id).');
      } catch (fkErr) {
        console.log('ℹ️ Foreign key constraint on parent_id might already exist:', fkErr.message);
      }
    } else {
      console.log('ℹ️ parent_id column already exists.');
    }

    // 3. Add 'pdf_notices_per_page' to users
    const [pdfCols] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'pdf_notices_per_page'");
    if (pdfCols.length === 0) {
      await pool.query("ALTER TABLE `users` ADD COLUMN `pdf_notices_per_page` INT NOT NULL DEFAULT 3");
      console.log('✅ Added pdf_notices_per_page column to users table.');
    } else {
      console.log('ℹ️ pdf_notices_per_page column already exists.');
    }

    console.log('🎉 RBAC migration completed successfully!');
  } catch (err) {
    console.error('❌ RBAC Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
