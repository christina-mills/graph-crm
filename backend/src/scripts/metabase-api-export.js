const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Metabase API configuration from environment variables
const METABASE_URL = process.env.METABASE_URL || 'https://your-metabase-instance.com';
const METABASE_API_KEY = process.env.METABASE_API_KEY;

async function findDatabaseId(apiKey) {
  try {
    console.log('🔍 Finding production_metrics database ID...');
    
    const response = await axios.get(`${METABASE_URL}/api/database`, {
      headers: {
        'X-Metabase-Session': apiKey
      }
    });
    
    const databases = response.data.data || response.data;
    console.log(`Found ${Array.isArray(databases) ? databases.length : 'unknown number of'} databases`);
    
    // Handle both array and object responses
    let dbList = [];
    if (Array.isArray(databases)) {
      dbList = databases;
    } else if (typeof databases === 'object') {
      dbList = Object.values(databases);
    }
    
    const prodMetrics = dbList.find(db => 
      db.name && (
        db.name.toLowerCase().includes('production_metrics') || 
        db.name.toLowerCase().includes('production metrics') ||
        db.name.toLowerCase().includes('bigquery')
      )
    );
    
    if (prodMetrics) {
      console.log(`✅ Found database: ${prodMetrics.name} (ID: ${prodMetrics.id})`);
      return prodMetrics.id;
    } else {
      console.log('Available databases:');
      dbList.forEach((db, index) => {
        if (db && db.name) {
          console.log(`  - ${db.name} (ID: ${db.id})`);
        }
      });
      
      // If production_metrics not found, let's use the first one or ask user to specify
      if (dbList.length > 0) {
        console.log('\n⚠️  production_metrics not found by name.');
        console.log('Using first available database. You may need to update the database ID in the query.');
        return dbList[0].id;
      }
      
      throw new Error('No databases found');
    }
  } catch (error) {
    console.error('Error finding database:', error.message);
    console.log('Response data:', error.response?.data);
    throw error;
  }
}

async function exportFromMetabase() {
  if (!METABASE_URL || METABASE_URL === 'https://your-metabase-instance.com') {
    console.error('❌ Please set your Metabase URL in .env file:');
    console.log('METABASE_URL=https://your-metabase-url.com');
    return;
  }

  try {
    let sessionToken;
    
    // Use API key if available, otherwise login with username/password
    if (METABASE_API_KEY) {
      console.log(`🔑 Using API key authentication...`);
      sessionToken = METABASE_API_KEY;
    } else if (METABASE_USERNAME && METABASE_PASSWORD) {
      console.log(`🔐 Logging into Metabase at ${METABASE_URL}...`);
      
      const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
        username: METABASE_USERNAME,
        password: METABASE_PASSWORD
      });
      
      sessionToken = loginResponse.data.id;
      console.log('✅ Logged in successfully');
    } else {
      console.error('❌ Please provide authentication in .env file:');
      console.log('Option 1: METABASE_API_KEY=your-api-key');
      console.log('Option 2: METABASE_USERNAME=your-email and METABASE_PASSWORD=your-password');
      return;
    }
    
    // Find the database ID - looking for BigQuery
    const databaseId = await findDatabaseId(sessionToken);
    
    // First, let's check what tables are available
    console.log('🔍 Checking available tables...');
    
    try {
      // Try to get table metadata
      const tablesResponse = await axios.get(`${METABASE_URL}/api/database/${databaseId}/metadata`, {
        headers: {
          'X-Metabase-Session': METABASE_API_KEY
        }
      });
      
      const tables = tablesResponse.data.tables || [];
      console.log(`Found ${tables.length} tables in database`);
      
      // Look for our table
      const hubspotTable = tables.find(t => 
        t.name && t.name.toLowerCase().includes('prod_hubspot_dimensions')
      );
      
      if (hubspotTable) {
        console.log(`✅ Found table: ${hubspotTable.name}`);
      } else {
        console.log('⚠️  prod_hubspot_dimensions table not found');
        console.log('Available tables with "hubspot" in name:');
        tables.filter(t => t.name && t.name.toLowerCase().includes('hubspot'))
              .forEach(t => console.log(`  - ${t.name}`));
        
        console.log('Available tables with "prod" in name:');
        tables.filter(t => t.name && t.name.toLowerCase().includes('prod'))
              .forEach(t => console.log(`  - ${t.name}`));
      }
    } catch (error) {
      console.log('Could not fetch table metadata:', error.message);
    }
    
    // Create a query to get wallet mappings
    const query = {
      database: databaseId,
      type: "native",
      native: {
        query: `
          SELECT DISTINCT
            wallet_address,
            company_name
          FROM production_metrics.prod_hubspot_dimensions
          WHERE wallet_address IS NOT NULL
            AND wallet_address != ''
            AND wallet_address != 'None'
            AND company_name IS NOT NULL
            AND company_name != ''
            AND company_name != 'None'
          ORDER BY company_name, wallet_address
          LIMIT 10000
        `
      }
    };
    
    console.log('🔄 Running query...');
    
    // Execute the query
    const queryResponse = await axios.post(
      `${METABASE_URL}/api/dataset`,
      query,
      {
        headers: {
          'X-Metabase-Session': METABASE_API_KEY
        }
      }
    );
    
    const results = queryResponse.data.data.rows;
    console.log(`✅ Found ${results.length} wallet mappings`);
    
    // Save to CSV
    const csvPath = path.join(__dirname, '../../../data-migration/metabase-wallet-mappings.csv');
    const csvContent = [
      'wallet_address,company_name',
      ...results.map(row => `"${row[0]}","${row[1]}"`)
    ].join('\n');
    
    fs.writeFileSync(csvPath, csvContent);
    console.log(`💾 Saved to ${csvPath}`);
    
    // Also save as JSON for easier processing
    const jsonPath = path.join(__dirname, '../../../data-migration/metabase-wallet-mappings.json');
    const jsonData = results.map(row => ({
      wallet_address: row[0],
      company_name: row[1]
    }));
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
    console.log(`💾 Also saved as JSON to ${jsonPath}`);
    
    // Show some statistics
    const companyCount = new Set(results.map(row => row[1])).size;
    console.log(`\n📊 Statistics:`);
    console.log(`   Total mappings: ${results.length}`);
    console.log(`   Unique companies: ${companyCount}`);
    console.log(`   Average wallets per company: ${(results.length / companyCount).toFixed(1)}`);
    
    console.log('\n✅ Export complete!');
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('❌ Login failed. Check your username and password.');
    } else if (error.response?.status === 404) {
      console.error('❌ API endpoint not found. Check your Metabase URL.');
    } else {
      console.error('❌ Export failed:', error.response?.data || error.message);
    }
  }
}

// Run the export
exportFromMetabase();