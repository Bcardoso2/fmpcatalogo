const express = require('express')
const bcrypt = require('bcrypt')
const { query } = require('../config/database')
const router = express.Router()

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body
    
    if (!phone || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telefone e senha são obrigatórios' 
      })
    }
    
    const result = await query(
      `SELECT id, phone, name, email, client_id, credits, role, is_active, password_hash, cpf,
              terms_accepted, terms_accepted_at
       FROM users
       WHERE phone = $1 AND is_active = true`,
      [phone]
    )
    
    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: 'Telefone ou senha incorretos' 
      })
    }
    
    const user = result.rows[0]
    
    const isValidPassword = await bcrypt.compare(password, user.password_hash)
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        error: 'Telefone ou senha incorretos' 
      })
    }
    
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
    
    req.session.userId = user.id
    req.session.userPhone = user.phone
    req.session.userName = user.name
    
    res.json({ 
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        credits: parseFloat(user.credits),
        role: user.role,
        terms_accepted: user.terms_accepted || false,
        terms_accepted_at: user.terms_accepted_at || null
      }
    })
    
  } catch (error) {
    console.error('Erro no login:', error)
    res.status(500).json({ success: false, error: 'Erro no servidor' })
  }
})

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password } = req.body
    
    if (!name || !phone || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nome, telefone e senha são obrigatórios' 
      })
    }
    
    const existingUser = await query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    )
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Este telefone já está cadastrado' 
      })
    }
    
    const password_hash = await bcrypt.hash(password, 10)
    
    const result = await query(
      `INSERT INTO users (phone, name, email, password_hash, role, credits, is_active, terms_accepted)
       VALUES ($1, $2, $3, $4, 'customer', 0, true, false)
       RETURNING id, phone, name, email, credits, role, cpf, terms_accepted, terms_accepted_at`,
      [phone, name, email || null, password_hash]
    )
    
    const user = result.rows[0]
    
    req.session.userId = user.id
    req.session.userPhone = user.phone
    req.session.userName = user.name
    
    res.json({ 
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        credits: parseFloat(user.credits),
        role: user.role,
        terms_accepted: user.terms_accepted || false,
        terms_accepted_at: user.terms_accepted_at || null
      }
    })
    
  } catch (error) {
    console.error('Erro no registro:', error)
    res.status(500).json({ success: false, error: 'Erro no servidor' })
  }
})

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Erro ao fazer logout' })
    }
    res.json({ success: true })
  })
})

// GET /api/auth/me
router.get('/me', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' })
  }
  
  try {
    const result = await query(
      `SELECT id, phone, name, email, client_id, credits, role, cpf, terms_accepted, terms_accepted_at
       FROM users
       WHERE id = $1 AND is_active = true`,
      [req.session.userId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
    }
    
    const user = result.rows[0]
    
    res.json({ 
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        credits: parseFloat(user.credits),
        role: user.role,
        terms_accepted: user.terms_accepted || false,
        terms_accepted_at: user.terms_accepted_at || null
      }
    })
  } catch (error) {
    console.error('Erro ao buscar usuário:', error)
    res.status(500).json({ success: false, error: 'Erro no servidor' })
  }
})

// POST /api/auth/accept-terms
router.post('/accept-terms', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' })
  }
  
  try {
    const result = await query(
      `UPDATE users 
       SET terms_accepted = true, 
           terms_accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, phone, name, email, cpf, credits, role, terms_accepted, terms_accepted_at`,
      [req.session.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuário não encontrado' 
      })
    }

    const user = result.rows[0]

    res.json({ 
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        credits: parseFloat(user.credits),
        role: user.role,
        terms_accepted: user.terms_accepted,
        terms_accepted_at: user.terms_accepted_at
      }
    })
  } catch (error) {
    console.error('Erro ao aceitar termos:', error)
    res.status(500).json({ success: false, error: 'Erro ao aceitar termos' })
  }
})

// PATCH /api/auth/update-profile
router.patch('/update-profile', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' })
  }
  
  try {
    const { name, email, cpf } = req.body
    
    const updates = []
    const params = []
    let paramCount = 1
    
    if (name) {
      updates.push(`name = $${paramCount}`)
      params.push(name)
      paramCount++
    }
    
    if (email !== undefined) {
      updates.push(`email = $${paramCount}`)
      params.push(email || null)
      paramCount++
    }
    
    if (cpf !== undefined) {
      updates.push(`cpf = $${paramCount}`)
      params.push(cpf || null)
      paramCount++
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhum campo para atualizar' 
      })
    }
    
    params.push(req.session.userId)
    
    await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`,
      params
    )
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error)
    res.status(500).json({ success: false, error: 'Erro ao atualizar perfil' })
  }
})

// PATCH /api/auth/change-password
router.patch('/change-password', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' })
  }
  
  try {
    const { current_password, new_password } = req.body
    
    if (!current_password || !new_password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Senha atual e nova senha são obrigatórias' 
      })
    }
    
    if (new_password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'A nova senha deve ter no mínimo 6 caracteres' 
      })
    }
    
    const result = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.session.userId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuário não encontrado' 
      })
    }
    
    const user = result.rows[0]
    
    const isValidPassword = await bcrypt.compare(current_password, user.password_hash)
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        error: 'Senha atual incorreta' 
      })
    }
    
    const newPasswordHash = await bcrypt.hash(new_password, 10)
    
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, req.session.userId]
    )
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Erro ao alterar senha:', error)
    res.status(500).json({ success: false, error: 'Erro ao alterar senha' })
  }
})

// DELETE /api/auth/delete-account
router.delete('/delete-account', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' })
  }
  
  try {
    await query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1',
      [req.session.userId]
    )
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Erro ao destruir sessão:', err)
      }
    })
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Erro ao excluir conta:', error)
    res.status(500).json({ success: false, error: 'Erro ao excluir conta' })
  }
})

module.exports = router
