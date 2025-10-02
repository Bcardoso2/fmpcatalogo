const express = require('express')
const { query } = require('../config/database')
const { requireAuth, checkCredits } = require('../middleware/auth')
const router = express.Router()

// POST /api/proposals - Criar proposta (requer autenticação e créditos)
router.post('/', requireAuth, checkCredits(1), async (req, res) => {
  const client = await require('../config/database').pool.connect()
  
  try {
    const { vehicle_external_id, proposal_amount, customer_name, customer_phone, customer_email } = req.body
    
    if (!vehicle_external_id || !proposal_amount || !customer_name || !customer_phone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Dados incompletos' 
      })
    }
    
    await client.query('BEGIN')
    
    // Buscar veículo
    const vehicleResult = await client.query(
      'SELECT id, title, brand, model, year, price FROM vehicles WHERE external_id = $1 AND is_active = true',
      [vehicle_external_id]
    )
    
    if (vehicleResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ success: false, error: 'Veículo não encontrado' })
    }
    
    const vehicle = vehicleResult.rows[0]
    
    // Buscar saldo atual do usuário
    const userResult = await client.query(
      'SELECT credits FROM users WHERE id = $1',
      [req.session.userId]
    )
    
    const currentCredits = parseFloat(userResult.rows[0].credits)
    
    if (currentCredits < 1) {
      await client.query('ROLLBACK')
      return res.status(403).json({ 
        success: false, 
        error: 'Créditos insuficientes',
        credits: currentCredits
      })
    }
    
    // Criar proposta
    const proposalResult = await client.query(`
      INSERT INTO proposals (
        vehicle_id, vehicle_external_id, customer_name, customer_phone, 
        customer_email, proposal_amount, vehicle_info, user_id, credits_used, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *
    `, [
      vehicle.id,
      vehicle_external_id,
      customer_name,
      customer_phone,
      customer_email || null,
      proposal_amount,
      JSON.stringify({
        title: vehicle.title,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        price: vehicle.price
      }),
      req.session.userId,
      1.0
    ])
    
    // Debitar crédito
    await client.query(
      'UPDATE users SET credits = credits - 1 WHERE id = $1',
      [req.session.userId]
    )
    
    // Registrar transação
    await client.query(`
      INSERT INTO credit_transactions (
        user_id, type, amount, balance_before, balance_after,
        proposal_id, description
      ) VALUES ($1, 'proposal_debit', -1, $2, $3, $4, $5)
    `, [
      req.session.userId,
      currentCredits,
      currentCredits - 1,
      proposalResult.rows[0].id,
      `Débito por proposta - ${vehicle.title}`
    ])
    
    await client.query('COMMIT')
    
    res.json({ 
      success: true,
      proposal: proposalResult.rows[0],
      remaining_credits: currentCredits - 1
    })
    
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Erro ao criar proposta:', error)
    res.status(500).json({ success: false, error: 'Erro ao criar proposta' })
  } finally {
    client.release()
  }
})

// GET /api/proposals/my - Minhas propostas (CORRIGIDO)
router.get('/my', requireAuth, async (req, res) => {
    // 1. Conecta ao pool de conexões
    const client = await require('../config/database').pool.connect();
    
    try {
        const result = await client.query(`
            SELECT 
                p.id, p.vehicle_external_id, p.proposal_amount, p.status,
                p.created_at,
                -- Inclui os campos do JOIN e o JSON de backup (vehicle_info)
                v.brand, v.model, v.year, 
                p.vehicle_info 
            FROM proposals p
            LEFT JOIN vehicles v ON p.vehicle_id = v.id
            WHERE p.user_id = $1
            ORDER BY p.created_at DESC
        `, [req.session.userId]);
        
        // Mapeia os resultados para garantir que vehicle_info seja um objeto JSON se for uma string
        const proposals = result.rows.map(row => {
            if (row.vehicle_info && typeof row.vehicle_info === 'string') {
                try {
                    // Tenta converter a string JSON do banco em um objeto
                    row.vehicle_info = JSON.parse(row.vehicle_info);
                } catch (e) {
                    console.warn("vehicle_info não é um JSON válido e foi ignorado.");
                    // Deixa como está ou define como null
                }
            }
            return row;
        });

        res.json({ 
            success: true, 
            proposals: proposals 
        });
        
    } catch (error) {
        console.error('Erro ao buscar propostas:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar propostas' });
    } finally {
        // 2. MUITO IMPORTANTE: Libera a conexão do cliente de volta para o pool
        client.release();
    }
});

module.exports = router