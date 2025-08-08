const { query } = require('../config/database');

async function createTelegramTables() {
  try {
    console.log('🔄 Creating Telegram tables...');

    // Add telegram fields to users table
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(255),
      ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT,
      ADD COLUMN IF NOT EXISTS telegram_enabled BOOLEAN DEFAULT false
    `);

    // Create telegram messages table
    await query(`
      CREATE TABLE IF NOT EXISTS telegram_messages (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        chat_title VARCHAR(255),
        chat_type VARCHAR(50),
        message_id BIGINT,
        from_id BIGINT,
        from_username VARCHAR(255),
        from_first_name VARCHAR(255),
        text TEXT,
        date TIMESTAMP,
        bot_id VARCHAR(255),
        is_outgoing BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_telegram_chat_id (chat_id),
        INDEX idx_telegram_date (date),
        INDEX idx_telegram_username (from_username)
      )
    `);

    // Create telegram groups table
    await query(`
      CREATE TABLE IF NOT EXISTS telegram_groups (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT UNIQUE NOT NULL,
        title VARCHAR(255),
        type VARCHAR(50),
        member_count INTEGER,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        company_id UUID REFERENCES companies(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create telegram broadcast history
    await query(`
      CREATE TABLE IF NOT EXISTS telegram_broadcasts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        message TEXT NOT NULL,
        chat_ids BIGINT[],
        sent_by UUID REFERENCES users(id),
        success_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    // Update telegram_conversations if it exists
    await query(`
      ALTER TABLE telegram_conversations
      ADD COLUMN IF NOT EXISTS last_message_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0
    `);

    console.log('✅ Telegram tables created successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  }
}

createTelegramTables();