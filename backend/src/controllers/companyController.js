const Company = require('../models/company');

// Get all companies
const getAllCompanies = async (req, res) => {
  try {
    const { limit = 100, offset = 0, search } = req.query;
    
    // If search parameter exists, filter by it
    let companies;
    if (search) {
      companies = await Company.searchByName(search, parseInt(limit), parseInt(offset));
    } else {
      companies = await Company.findAll(parseInt(limit), parseInt(offset));
    }
    
    res.json({
      success: true,
      count: companies.length,
      data: companies
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch companies'
    });
  }
};

// Get single company
const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await Company.findById(id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch company'
    });
  }
};

// Create new company
const createCompany = async (req, res) => {
  try {
    const company = await Company.create(req.body);
    
    res.status(201).json({
      success: true,
      data: company
    });
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create company'
    });
  }
};

// Update company
const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await Company.update(id, req.body);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update company'
    });
  }
};

// Get top companies by usage
const getTopCompaniesByUsage = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const companies = await Company.getTopByUsage(parseInt(limit));
    
    res.json({
      success: true,
      count: companies.length,
      data: companies
    });
  } catch (error) {
    console.error('Error fetching top companies:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch top companies'
    });
  }
};

module.exports = {
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  getTopCompaniesByUsage
};