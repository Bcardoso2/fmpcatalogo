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
    
    // Buscar usuário - ✅ ADICIONAR CPF AQUI
    const result = await query(
      `SELECT id, phone, name, email, client_id, credits, role, is_active, password_hash, cpf
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
    
    // Verificar senha
    const isValidPassword = await bcrypt.compare(password, user.password_hash)
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        error: 'Telefone ou senha incorretos' 
      })
    }
    
    // Atualizar último login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
    
    // Criar sessão
    req.session.userId = user.id
    req.session.userPhone = user.phone
    req.session.userName = user.name
    
    // Retornar dados do usuário - ✅ ADICIONAR CPF AQUI
    res.json({ 
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        cpf: user.cpf, // ✅ ADICIONAR
        credits: parseFloat(user.credits),
        role: user.role
      }
    })
    
  } catch (error) {
    console.error('Erro no login:', error)
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
    // ✅ ADICIONAR CPF AQUI
    const result = await query(
      `SELECT id, phone, name, email, client_id, credits, role, cpf
       FROM users
       WHERE id = $1 AND is_active = true`,
      [req.session.userId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
    }
    
    const user = result.rows[0]
    
    // ✅ ADICIONAR CPF AQUI
    res.json({ 
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        cpf: user.cpf, // ✅ ADICIONAR
        credits: parseFloat(user.credits),
        role: user.role
      }
    })
  } catch (error) {
    console.error('Erro ao buscar usuário:', error)
    res.status(500).json({ success: false, error: 'Erro no servidor' })
  }
})

module.exports = router