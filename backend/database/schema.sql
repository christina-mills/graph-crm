-- Create database (run this in psql)
-- CREATE DATABASE graph_crm;

-- Use the database
-- \c graph_crm;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations (Edge & Node, StreamingFast, Pinax, etc.)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    tier VARCHAR(50) DEFAULT 'partner', -- 'protocol', 'core_dev', 'partner'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    organization_id UUID REFERENCES organizations(id),
    role VARCHAR(50) DEFAULT 'user', -- 'admin', 'sales', 'user'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Companies (from HubSpot)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hubspot_id VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    organization_id UUID REFERENCES organizations(id),
    
    -- Graph usage data (from Withorb)
    monthly_query_volume BIGINT DEFAULT 0,
    total_queries_to_date BIGINT DEFAULT 0,
    mrr_usd DECIMAL(10, 2) DEFAULT 0,
    
    -- Additional fields
    industry VARCHAR(100),
    employee_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contacts (from HubSpot)
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hubspot_id VARCHAR(255) UNIQUE,
    email VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    company_id UUID REFERENCES companies(id),
    telegram_username VARCHAR(100),
    is_primary_contact BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deals (from HubSpot)
CREATE TABLE deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hubspot_id VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    company_id UUID REFERENCES companies(id),
    primary_contact_id UUID REFERENCES contacts(id),
    stage VARCHAR(100), -- 'lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'
    amount DECIMAL(10, 2),
    expected_monthly_queries BIGINT,
    close_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quotes
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id UUID REFERENCES deals(id),
    quote_number VARCHAR(50) UNIQUE,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'pending_approval', 'approved', 'sent', 'signed'
    total_amount DECIMAL(10, 2),
    monthly_amount DECIMAL(10, 2),
    query_volume_included BIGINT,
    price_per_additional_query DECIMAL(10, 6),
    
    -- Approval workflow
    submitted_for_approval_at TIMESTAMP,
    approved_by VARCHAR(255), -- Will be 'Christina Mills' when approved
    approved_at TIMESTAMP,
    approval_notes TEXT,
    
    -- DocuSign integration
    docusign_envelope_id VARCHAR(255),
    sent_at TIMESTAMP,
    signed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telegram conversations for lead qualification
CREATE TABLE telegram_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id BIGINT NOT NULL,
    username VARCHAR(100),
    contact_id UUID REFERENCES contacts(id),
    qualification_status VARCHAR(50) DEFAULT 'new', -- 'new', 'qualifying', 'qualified', 'disqualified'
    
    -- Qualification data
    company_size VARCHAR(50),
    use_case TEXT,
    monthly_query_estimate BIGINT,
    timeline VARCHAR(50),
    
    assigned_to UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usage tracking (synced from Withorb)
CREATE TABLE usage_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    date DATE NOT NULL,
    query_count BIGINT DEFAULT 0,
    cost_usd DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, date)
);

-- Create indexes for better performance
CREATE INDEX idx_companies_organization ON companies(organization_id);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_deals_company ON deals(company_id);
CREATE INDEX idx_usage_metrics_company_date ON usage_metrics(company_id, date);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();