const metabaseService = require('../services/metabaseService');
require('dotenv').config();

async function runImport() {
  console.log('🚀 Starting Metabase wallet import...');
  
  // Check if credentials are set
  if (!process.env.METABASE_DB_NAME) {
    console.error('❌ Metabase database credentials not found!');
    console.log('\nPlease add to your .env file:');
    console.log('METABASE_DB_HOST=your-host');
    console.log('METABASE_DB_PORT=5432');
    console.log('METABASE_DB_NAME=your-database');
    console.log('METABASE_DB_USER=your-user');
    console.log('METABASE_DB_PASSWORD=your-password');
    console.log('METABASE_DB_SSL=true');
    process.exit(1);
  }

  try {
    await metabaseService.importWalletMappings();
    await metabaseService.close();
    
    console.log('\n✨ Import completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    await metabaseService.close();
    process.exit(1);
  }
}

// Run the import
runImport();