const axios = require('axios');
require('dotenv').config();

const METABASE_URL = process.env.METABASE_URL;
const METABASE_USERNAME = process.env.METABASE_USERNAME;
const METABASE_PASSWORD = process.env.METABASE_PASSWORD;

async function exploreTable() {
  try {
    // First, let's check the database metadata for schemas
    console.log('🔍 Checking database schemas...');
    try {
      const dbMetadata = await axios.get(`${METABASE_URL}/api/database/2/metadata`, {
        headers: {
          'X-Metabase-Session': sessionToken
        }
      });
      
      const tables = dbMetadata.data.tables || [];
      console.log(`\nFound ${tables.length} tables total`);
      
      // Group tables by schema
      const schemas = {};
      tables.forEach(table => {
        const schema = table.schema || 'default';
        if (!schemas[schema]) schemas[schema] = [];
        schemas[schema].push(table.name);
      });
      
      console.log('\nSchemas and tables:');
      Object.keys(schemas).forEach(schema => {
        console.log(`\n${schema}:`);
        schemas[schema].slice(0, 5).forEach(table => {
          console.log(`  - ${table}`);
        });
        if (schemas[schema].length > 5) {
          console.log(`  ... and ${schemas[schema].length - 5} more tables`);
        }
      });
      
      // Look for hubspot table
      console.log('\nSearching for hubspot tables...');
      tables.filter(t => t.name.toLowerCase().includes('hubspot')).forEach(table => {
        console.log(`Found: ${table.schema}.${table.name} (ID: ${table.id})`);
      });
      
    } catch (error) {
      console.log('Could not fetch detailed metadata');
    }
    
    // Login
    const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
      username: METABASE_USERNAME,
      password: METABASE_PASSWORD
    });
    
    const sessionToken = loginResponse.data.id;
    console.log('✅ Logged in successfully\n');
    
    // Query 1: Get sample data from the table
    console.log('📊 Query 1: Sample data from prod_hubspot_dimensions');
    
    // Try different table path formats
    const tableVariations = [
      'prod_hubspot_dimensions',
      'production_metrics.prod_hubspot_dimensions',
      'prod.prod_hubspot_dimensions',
      'hubspot.prod_hubspot_dimensions',
      'default.prod_hubspot_dimensions'
    ];
    
    let workingTable = null;
    
    for (const tablePath of tableVariations) {
      try {
        console.log(`\nTrying: ${tablePath}`);
        const testQuery = {
          database: 2, // BigQuery
          type: "native",
          native: {
            query: `SELECT * FROM ${tablePath} LIMIT 1`
          }
        };
        
        const testResponse = await axios.post(
          `${METABASE_URL}/api/dataset`,
          testQuery,
          {
            headers: {
              'X-Metabase-Session': sessionToken
            }
          }
        );
        
        if (testResponse.data.data.rows.length > 0) {
          console.log(`✅ Success! Table found at: ${tablePath}`);
          workingTable = tablePath;
          
          // Show columns
          console.log('\nColumns found:');
          testResponse.data.data.cols.forEach((col, i) => {
            console.log(`  ${i + 1}. ${col.name} (${col.base_type})`);
          });
          
          // Show sample data
          console.log('\nFirst row:');
          const firstRow = testResponse.data.data.rows[0];
          testResponse.data.data.cols.forEach((col, i) => {
            if (firstRow[i]) {
              console.log(`  ${col.name}: ${JSON.stringify(firstRow[i]).substring(0, 50)}...`);
            }
          });
          
          break;
        }
      } catch (error) {
        console.log(`  ❌ Failed: ${error.response?.data?.message || error.message}`);
      }
    }
    
    // Query 2: Check for wallet-like columns
    console.log('\n📊 Query 2: Looking for wallet columns');
    const walletColumnsQuery = {
      database: 2,
      type: "native",
      native: {
        query: `
          SELECT 
            COUNT(*) as total_rows,
            COUNT(wallet_address) as wallet_address_count,
            COUNT(company_name) as company_name_count
          FROM prod_hubspot_dimensions
        `
      }
    };
    
    try {
      const walletResponse = await axios.post(
        `${METABASE_URL}/api/dataset`,
        walletColumnsQuery,
        {
          headers: {
            'X-Metabase-Session': sessionToken
          }
        }
      );
      
      console.log('Count results:', walletResponse.data.data.rows[0]);
    } catch (error) {
      console.log('wallet_address column might not exist');
    }
    
    // Query 3: Find columns with wallet data
    console.log('\n📊 Query 3: Searching for Ethereum addresses in all columns');
    const columns = sampleResponse.data.data.cols.map(col => col.name);
    
    for (const column of columns.slice(0, 10)) { // Check first 10 columns
      try {
        const checkQuery = {
          database: 2,
          type: "native",
          native: {
            query: `
              SELECT COUNT(*) as ethereum_addresses
              FROM prod_hubspot_dimensions
              WHERE LOWER(${column}) LIKE '0x%'
              LIMIT 1
            `
          }
        };
        
        const checkResponse = await axios.post(
          `${METABASE_URL}/api/dataset`,
          checkQuery,
          {
            headers: {
              'X-Metabase-Session': sessionToken
            }
          }
        );
        
        const count = checkResponse.data.data.rows[0][0];
        if (count > 0) {
          console.log(`✅ Found ${count} Ethereum addresses in column: ${column}`);
        }
      } catch (error) {
        // Skip errors for individual columns
      }
    }
    
    // Logout
    await axios.delete(`${METABASE_URL}/api/session`, {
      headers: {
        'X-Metabase-Session': sessionToken
      }
    });
    
    console.log('\n✅ Exploration complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

exploreTable();