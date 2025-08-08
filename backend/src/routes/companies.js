const express = require('express');
const router = express.Router();
const {
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  getTopCompaniesByUsage
} = require('../controllers/companyController');

// GET /api/companies
router.get('/', getAllCompanies);

// GET /api/companies/top-usage
router.get('/top-usage', getTopCompaniesByUsage);

// GET /api/companies/:id
router.get('/:id', getCompanyById);

// POST /api/companies
router.post('/', createCompany);

// PUT /api/companies/:id
router.put('/:id', updateCompany);

module.exports = router;