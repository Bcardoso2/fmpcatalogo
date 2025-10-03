const express = require('express')
const { query } = require('../config/database')
const { requireAuth } = require('../middleware/auth')
const router = express.Router()

// Middleware para verificar se é admin
const requireAdmin = async (req, res, next) => {
  try {
    const result = await query('SELECT role FROM users WHERE id = $1', [req.session.userId])
    
    if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado' })
    }
    
    next()
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao verificar permissões' })
  }
}

// GET /api/admin/dashboard - Estatísticas gerais
router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
        (SELECT COUNT(*) FROM vehicles WHERE is_active = true) as total_vehicles,
        (SELECT COUNT(*) FROM proposals WHERE status = 'pending') as pending_proposals,
        (SELECT COUNT(*) FROM proposals WHERE status = 'accepted') as accepted_proposals,
        (SELECT SUM(credits) FROM users) as total_credits,
        (SELECT SUM(amount) FROM credit_transactions WHERE type = 'purchase') as total_revenue
    `)
    
    res.json({ success: true, stats: stats.rows[0] })
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error)
    res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' })
  }
})

// GET /api/admin/users - Listar usuários
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await query(`
      SELECT 
        id, phone, name, email, credits, total_credits_purchased,
        role, is_active, created_at, last_login
      FROM users
      ORDER BY created_at DESC
    `)
    
    res.json({ success: true, users: users.rows })
  } catch (error) {
    console.error('Erro ao listar usuários:', error)
    res.status(500).json({ success: false, error: 'Erro ao listar usuários' })
  }
})

// POST /api/admin/users/:userId/credits - Adicionar créditos manualmente
router.post('/users/:userId/credits', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params
    const { amount, description } = req.body
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Valor inválido' })
    }
    
    await query('BEGIN')
    
    const userResult = await query('SELECT credits FROM users WHERE id = $1', [userId])
    if (userResult.rows.length === 0) {
      await query('ROLLBACK')
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
    }
    
    const currentCredits = parseFloat(userResult.rows[0].credits)
    const newCredits = currentCredits + parseFloat(amount)
    
    await query('UPDATE users SET credits = $1 WHERE id = $2', [newCredits, userId])
    
    await query(`
      INSERT INTO credit_transactions (
        user_id, type, amount, balance_before, balance_after,
        description
      ) VALUES ($1, 'admin_adjustment', $2, $3, $4, $5)
    `, [userId, amount, currentCredits, newCredits, description || 'Ajuste manual admin'])
    
    await query('COMMIT')
    
    res.json({ success: true, new_balance: newCredits })
  } catch (error) {
    await query('ROLLBACK')
    console.error('Erro ao adicionar créditos:', error)
    res.status(500).json({ success: false, error: 'Erro ao adicionar créditos' })
  }
})

// GET /api/admin/proposals - Listar propostas
router.get('/proposals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query
    
    let queryStr = `
      SELECT 
        p.*,
        u.name as user_name,
        u.phone as user_phone,
        v.brand as vehicle_brand,
        v.model as vehicle_model,
        v.year as vehicle_year,
        v.price as vehicle_price
      FROM proposals p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN vehicles v ON p.vehicle_id = v.id
    `
    
    const params = []
    if (status) {
      queryStr += ' WHERE p.status = $1'
      params.push(status)
    }
    
    queryStr += ' ORDER BY p.created_at DESC'
    
    const proposals = await query(queryStr, params)
    
    res.json({ success: true, proposals: proposals.rows })
  } catch (error) {
    console.error('Erro ao listar propostas:', error)
    res.status(500).json({ success: false, error: 'Erro ao listar propostas' })
  }
})

// PUT /api/admin/proposals/:proposalId/status - Atualizar status da proposta
router.put('/proposals/:proposalId/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { proposalId } = req.params
    const { status, notes } = req.body
    
    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status inválido' })
    }
    
    await query('BEGIN')
    
    await query(`
      UPDATE proposals 
      SET status = $1, notes = $2, approved_at = NOW(), approved_by = $3
      WHERE id = $4
    `, [status, notes, req.session.userId, proposalId])
    
    // Se aceitar, marcar como proposta vencedora
    if (status === 'accepted') {
      const proposalResult = await query('SELECT vehicle_id FROM proposals WHERE id = $1', [proposalId])
      
      if (proposalResult.rows.length > 0) {
        const vehicleId = proposalResult.rows[0].vehicle_id
        
        await query('UPDATE proposals SET is_winner = true WHERE id = $1', [proposalId])
        await query('UPDATE vehicles SET has_winning_proposal = true WHERE id = $1', [vehicleId])
        await query(`
          UPDATE proposals 
          SET status = 'rejected' 
          WHERE vehicle_id = $1 AND id != $2 AND status = 'pending'
        `, [vehicleId, proposalId])
      }
    }
    
    await query('COMMIT')
    
    res.json({ success: true })
  } catch (error) {
    await query('ROLLBACK')
    console.error('Erro ao atualizar proposta:', error)
    res.status(500).json({ success: false, error: 'Erro ao atualizar proposta' })
  }
})

// GET /api/admin/transactions - Listar transações
router.get('/transactions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const transactions = await query(`
      SELECT 
        ct.*,
        u.name as user_name,
        u.phone as user_phone
      FROM credit_transactions ct
      LEFT JOIN users u ON ct.user_id = u.id
      ORDER BY ct.created_at DESC
      LIMIT 100
    `)
    
    res.json({ success: true, transactions: transactions.rows })
  } catch (error) {
    console.error('Erro ao listar transações:', error)
    res.status(500).json({ success: false, error: 'Erro ao listar transações' })
  }
})

module.exports = router