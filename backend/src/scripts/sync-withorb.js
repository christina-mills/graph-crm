const withorbService = require('../services/withorbService');
require('dotenv').config();

async function runSync() {
  console.log('🚀 Starting manual Withorb sync...');
  console.log(`⚙️  Using API key: ${process.env.WITHORB_API_KEY ? 'Set' : 'NOT SET'}`);
  
  if (!process.env.WITHORB_API_KEY) {
    console.error('❌ WITHORB_API_KEY not found in environment variables!');
    console.log('Please add WITHORB_API_KEY=your_api_key to your .env file');
    process.exit(1);
  }

  try {
    const results = await withorbService.syncAllCustomers();
    console.log('\n✨ Sync completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Run the sync
runSync();