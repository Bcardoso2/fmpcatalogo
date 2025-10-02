function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ 
      success: false, 
      error: 'Não autenticado. Faça login primeiro.' 
    })
  }
  next()
}

function checkCredits(minCredits = 1) {
  return async (req, res, next) => {
    try {
      const { query } = require('../config/database')
      const result = await query(
        'SELECT credits FROM users WHERE id = $1',
        [req.session.userId]
      )
      
      if (!result.rows[0]) {
        return res.status(404).json({ 
          success: false, 
          error: 'Usuário não encontrado' 
        })
      }
      
      const credits = parseFloat(result.rows[0].credits)
      
      if (credits < minCredits) {
        return res.status(403).json({ 
          success: false, 
          error: 'Créditos insuficientes',
          credits,
          required: minCredits
        })
      }
      
      req.userCredits = credits
      next()
    } catch (error) {
      console.error('Erro ao verificar créditos:', error)
      res.status(500).json({ success: false, error: 'Erro ao verificar créditos' })
    }
  }
}

module.exports = { requireAuth, checkCredits }