const { query } = require('../config/database');

async function seedData() {
  try {
    console.log('🌱 Seeding test data...');

    // Create test organizations
    const orgResult = await query(`
      INSERT INTO organizations (name, tier) 
      VALUES 
        ('Edge & Node', 'core_dev'),
        ('StreamingFast', 'core_dev'),
        ('Pinax', 'core_dev')
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `);
    
    console.log(`✅ Created ${orgResult.rowCount} organizations`);

    // Get Edge & Node org ID for test companies
    const edgeNodeOrg = orgResult.rows.find(org => org.name === 'Edge & Node');

    // Create test companies
    const companyResult = await query(`
      INSERT INTO companies (
        name, domain, organization_id, 
        monthly_query_volume, mrr_usd, industry, employee_count
      ) 
      VALUES 
        ('Uniswap', 'uniswap.org', $1, 2500000, 75000, 'DeFi', 50),
        ('Aave', 'aave.com', $1, 1800000, 54000, 'DeFi', 35),
        ('Compound', 'compound.finance', $1, 1200000, 36000, 'DeFi', 25),
        ('Synthetix', 'synthetix.io', $1, 900000, 27000, 'DeFi', 20),
        ('Chainlink', 'chain.link', $1, 3200000, 96000, 'Oracle', 100)
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `, [edgeNodeOrg?.id]);
    
    console.log(`✅ Created ${companyResult.rowCount} companies`);

    // Create test user (Christina Mills)
    const userResult = await query(`
      INSERT INTO users (
        email, password_hash, first_name, last_name, 
        organization_id, role
      )
      VALUES (
        'christina.mills@edgeandnode.com',
        '$2a$10$somehashedpassword', -- This is just a placeholder
        'Christina',
        'Mills',
        $1,
        'admin'
      )
      ON CONFLICT DO NOTHING
      RETURNING id, email
    `, [edgeNodeOrg?.id]);
    
    console.log(`✅ Created ${userResult.rowCount} users`);

    console.log('✨ Seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

// Run the seed function
seedData();