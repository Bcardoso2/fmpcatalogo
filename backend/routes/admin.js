// Criar usuário
    const credits = parseFloat(initial_credits) || 0
    
    // Pegar o client_id do admin logado
    const adminResult = await query('SELECT client_id FROM users WHERE id = $1', [req.session.userId])
    const client_id = adminResult.rows[0]?.client_id || 'client1'
    
    // Inserir usuário com client_id
    const userResult = await query(`
      INSERT INTO users (
        phone, 
        password_hash, 
        name, 
        email, 
        role, 
        credits, 
        total_credits_purchased,
        is_active,
        client_id,
        created_atconst express = require('express')
const bcrypt = require('bcrypt')
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

// POST /api/admin/users/create - Criar novo usuário
router.post('/users/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role, initial_credits } = req.body
    
    // Validações
    if (!name || !phone || !password || !role) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nome, telefone, senha e tipo são obrigatórios' 
      })
    }
    
    if (name.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nome deve ter no mínimo 3 caracteres' 
      })
    }
    
    if (!/^[0-9]{10,11}$/.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telefone inválido. Use apenas números (DDD + número)' 
      })
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Senha deve ter no mínimo 6 caracteres' 
      })
    }
    
    if (!['customer', 'admin', 'viewer'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tipo de usuário inválido' 
      })
    }
    
    await query('BEGIN')
    
    // Verificar se telefone já existe
    const existingUser = await query('SELECT id FROM users WHERE phone = $1', [phone])
    if (existingUser.rows.length > 0) {
      await query('ROLLBACK')
      return res.status(400).json({ 
        success: false, 
        error: 'Telefone já cadastrado' 
      })
    }
    
    // Verificar se email já existe (se fornecido)
    if (email) {
      const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email])
      if (existingEmail.rows.length > 0) {
        await query('ROLLBACK')
        return res.status(400).json({ 
          success: false, 
          error: 'Email já cadastrado' 
        })
      }
    }
    
    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10)
    
    // Criar usuário
    const credits = parseFloat(initial_credits) || 0
    
    // Gerar client_id aleatório (formato: client_XXXXX onde X é número/letra)
    const generateClientId = () => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
      let clientId = 'client_'
      for (let i = 0; i < 8; i++) {
        clientId += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return clientId
    }
    
    const client_id = generateClientId()
    
    // Inserir usuário com client_id gerado
    const userResult = await query(`
      INSERT INTO users (
        phone, 
        password_hash, 
        name, 
        email, 
        role, 
        credits, 
        total_credits_purchased,
        is_active,
        client_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id, phone, name, email, role, credits
    `, [
      phone, 
      hashedPassword,
      name, 
      email || null,
      role, 
      credits,
      0,
      true,
      client_id
    ])
    
    const newUser = userResult.rows[0]
    
    // Se tiver créditos iniciais, registrar transação
    if (credits > 0) {
      await query(`
        INSERT INTO credit_transactions (
          user_id, 
          type, 
          amount, 
          balance_before, 
          balance_after,
          description,
          created_at
        ) VALUES ($1, 'admin_adjustment', $2, 0, $3, $4, NOW())
      `, [
        newUser.id, 
        credits, 
        credits, 
        `Créditos iniciais ao criar usuário - Admin: ${req.session.userName || req.session.userId}`
      ])
    }
    
    await query('COMMIT')
    
    res.json({ 
      success: true, 
      message: 'Usuário criado com sucesso!',
      user: {
        id: newUser.id,
        name: newUser.name,
        phone: newUser.phone,
        email: newUser.email,
        role: newUser.role,
        credits: newUser.credits
      }
    })
  } catch (error) {
    await query('ROLLBACK')
    console.error('Erro ao criar usuário:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao criar usuário: ' + error.message 
    })
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
