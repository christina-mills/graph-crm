const { query } = require('../config/database');

class Company {
  // Get all companies with usage data
  static async findAll(limit = 100, offset = 0) {
    const sql = `
      SELECT 
        c.*,
        COUNT(DISTINCT ct.id) as contact_count,
        COUNT(DISTINCT d.id) as deal_count
      FROM companies c
      LEFT JOIN contacts ct ON ct.company_id = c.id
      LEFT JOIN deals d ON d.company_id = c.id
      GROUP BY c.id
      ORDER BY c.monthly_query_volume DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `;
    
    const result = await query(sql, [limit, offset]);
    return result.rows;
  }

  // Get a single company by ID
  static async findById(id) {
    const sql = `
      SELECT * FROM companies WHERE id = $1
    `;
    
    const result = await query(sql, [id]);
    return result.rows[0];
  }

  // Create a new company
  static async create(companyData) {
    const {
      name,
      domain,
      hubspot_id,
      organization_id,
      industry,
      employee_count
    } = companyData;

    const sql = `
      INSERT INTO companies (
        name, domain, hubspot_id, organization_id, 
        industry, employee_count
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [name, domain, hubspot_id, organization_id, industry, employee_count];
    const result = await query(sql, values);
    return result.rows[0];
  }

  // Update company
  static async update(id, companyData) {
    const {
      name,
      domain,
      industry,
      employee_count,
      monthly_query_volume,
      mrr_usd
    } = companyData;

    const sql = `
      UPDATE companies 
      SET 
        name = COALESCE($2, name),
        domain = COALESCE($3, domain),
        industry = COALESCE($4, industry),
        employee_count = COALESCE($5, employee_count),
        monthly_query_volume = COALESCE($6, monthly_query_volume),
        mrr_usd = COALESCE($7, mrr_usd)
      WHERE id = $1
      RETURNING *
    `;
    
    const values = [id, name, domain, industry, employee_count, monthly_query_volume, mrr_usd];
    const result = await query(sql, values);
    return result.rows[0];
  }

  // Get companies by organization
  static async findByOrganization(organizationId) {
    const sql = `
      SELECT * FROM companies 
      WHERE organization_id = $1
      ORDER BY created_at DESC
    `;
    
    const result = await query(sql, [organizationId]);
    return result.rows;
  }

  // Search companies by name
  static async searchByName(searchTerm, limit = 100, offset = 0) {
    const sql = `
      SELECT 
        c.*,
        COUNT(DISTINCT ct.id) as contact_count,
        COUNT(DISTINCT d.id) as deal_count
      FROM companies c
      LEFT JOIN contacts ct ON ct.company_id = c.id
      LEFT JOIN deals d ON d.company_id = c.id
      WHERE c.name ILIKE $1 OR c.domain ILIKE $1
      GROUP BY c.id
      ORDER BY c.monthly_query_volume DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `;
    
    const result = await query(sql, [`%${searchTerm}%`, limit, offset]);
    return result.rows;
  }

  // Get top companies by usage
  static async getTopByUsage(limit = 10) {
    const sql = `
      SELECT 
        c.*,
        c.monthly_query_volume as total_queries_30d
      FROM companies c
      WHERE c.monthly_query_volume > 0
      ORDER BY c.monthly_query_volume DESC
      LIMIT $1
    `;
    
    const result = await query(sql, [limit]);
    return result.rows;
  }
}

module.exports = Company;