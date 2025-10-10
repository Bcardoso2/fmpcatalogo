const express = require('express')
const { query } = require('../config/database')
const { requireAuth } = require('../middleware/auth')
const coraService = require('../services/coraService')
const router = express.Router()

// GET /api/credits/balance - Saldo de créditos do usuário logado
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT credits, total_credits_purchased FROM users WHERE id = $1',
      [req.session.userId]
    )
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
    }
    
    res.json({ 
      success: true,
      credits: parseFloat(result.rows[0].credits),
      total_purchased: parseFloat(result.rows[0].total_credits_purchased)
    })
  } catch (error) {
    console.error('Erro ao buscar saldo:', error)
    res.status(500).json({ success: false, error: 'Erro ao buscar saldo' })
  }
})

// GET /api/credits/transactions - Histórico de transações
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        id, type, amount, balance_before, balance_after,
        payment_amount, payment_method, description,
        created_at
      FROM credit_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId])
    
    res.json({ 
      success: true,
      transactions: result.rows 
    })
  } catch (error) {
    console.error('Erro ao buscar transações:', error)
    res.status(500).json({ success: false, error: 'Erro ao buscar transações' })
  }
})

// POST /api/credits/request-recharge - Solicitar recarga (gerar QR Code PIX)
router.post('/request-recharge', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body
    
    // Validação de valor mínimo
    if (!amount || amount < 1000) {
  return res.status(400).json({ 
    success: false, 
    error: 'Valor mínimo para recarga é R$ 1.000,00' 
  })
}
    
    // Buscar config da Cora
    const configResult = await query(
      'SELECT * FROM cora_account_config WHERE client_id = $1 AND is_active = true',
      ['client1']
    )
    
    if (configResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Configuração de pagamento não encontrada' 
      })
    }
    
    // Buscar dados do usuário COM CPF
    const userResult = await query(
      'SELECT id, name, email, phone, cpf FROM users WHERE id = $1',
      [req.session.userId]
    )
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuário não encontrado' 
      })
    }
    
    const config = configResult.rows[0]
    const user = userResult.rows[0]
    
    // Validar se o usuário tem CPF cadastrado
    if (!user.cpf) {
      return res.status(400).json({ 
        success: false, 
        error: 'CPF não cadastrado. Por favor, complete seu cadastro antes de fazer recargas.',
        requires_cpf: true
      })
    }
    
    const creditsToAdd = amount / parseFloat(config.credit_price)
    
    console.log('📝 Gerando QR Code PIX para:', {
      user: user.name,
      amount: amount,
      credits: creditsToAdd.toFixed(1)
    })
    
    // Criar QR Code PIX via Cora
    const invoice = await coraService.createPixInvoice(
      {
        name: user.name,
        email: user.email || `user${user.id.substring(0, 8)}@autogiro.app`,
        cpf: user.cpf
      },
      parseFloat(amount),
      `Recarga de ${creditsToAdd.toFixed(1)} créditos Autogiro`
    )
    
    if (!invoice.success) {
      console.error('❌ Erro Cora:', invoice.error)
      return res.status(500).json({ 
        success: false, 
        error: invoice.error || 'Erro ao gerar QR Code PIX' 
      })
    }
    
    console.log('✅ QR Code gerado:', invoice.invoice_id)
    
    // Salvar pedido pendente no banco
    const purchaseResult = await query(`
      INSERT INTO pending_credit_purchases (
        user_id, client_id, amount_requested, credits_to_add,
        pix_key, pix_qr_code, pix_copy_paste, cora_charge_id,
        status, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
      RETURNING *
    `, [
      req.session.userId,
      'client1',
      amount,
      creditsToAdd,
      config.pix_key,
      invoice.qr_code_url,
      invoice.qr_code_emv,
      invoice.invoice_id,
      invoice.due_date
    ])
    
    res.json({ 
      success: true,
      purchase: {
        id: purchaseResult.rows[0].id,
        amount: parseFloat(amount),
        credits: parseFloat(creditsToAdd.toFixed(1)),
        qr_code_image: invoice.qr_code_url,
        copy_paste_code: invoice.qr_code_emv,
        expires_at: invoice.due_date,
        status: invoice.status,
        account_info: {
          pix_key: config.pix_key,
          pix_type: config.pix_type,
          account_name: config.account_name
        }
      }
    })
  } catch (error) {
    console.error('❌ Erro ao solicitar recarga:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao processar solicitação de recarga' 
    })
  }
})

// GET /api/credits/check-payment/:purchaseId - Verificar status do pagamento
router.get('/check-payment/:purchaseId', requireAuth, async (req, res) => {
  try {
    const { purchaseId } = req.params
    
    const purchase = await query(
      'SELECT * FROM pending_credit_purchases WHERE id = $1 AND user_id = $2',
      [purchaseId, req.session.userId]
    )
    
    if (purchase.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Pedido não encontrado' 
      })
    }
    
    const pendingPurchase = purchase.rows[0]
    
    // Se já foi pago
    if (pendingPurchase.status === 'paid') {
      return res.json({ 
        success: true, 
        status: 'paid', 
        paid_at: pendingPurchase.paid_at,
        credits_added: parseFloat(pendingPurchase.credits_to_add)
      })
    }
    
    // Verificar na Cora
    const invoiceStatus = await coraService.checkInvoiceStatus(
      pendingPurchase.cora_charge_id
    )
    
    if (!invoiceStatus.success) {
      return res.json({ 
        success: true, 
        status: pendingPurchase.status,
        message: 'Aguardando confirmação do pagamento'
      })
    }
    
    console.log(`🔍 Status da cobrança ${pendingPurchase.cora_charge_id}:`, invoiceStatus.status)
    
    // Se foi pago
    if (invoiceStatus.status === 'PAID' && invoiceStatus.is_paid) {
      try {
        await query('BEGIN')
        
        const userResult = await query(
          'SELECT credits FROM users WHERE id = $1', 
          [req.session.userId]
        )
        const currentCredits = parseFloat(userResult.rows[0].credits)
        const newCredits = currentCredits + parseFloat(pendingPurchase.credits_to_add)
        
        // Atualizar créditos
        await query(`
          UPDATE users 
          SET credits = $1, 
              total_credits_purchased = total_credits_purchased + $2,
              updated_at = NOW()
          WHERE id = $3
        `, [newCredits, pendingPurchase.credits_to_add, req.session.userId])
        
        // Marcar como pago
        await query(`
          UPDATE pending_credit_purchases 
          SET status = 'paid', 
              paid_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `, [purchaseId])
        
        // Registrar transação
        await query(`
          INSERT INTO credit_transactions (
            user_id, type, amount, balance_before, balance_after,
            payment_amount, payment_method, cora_transaction_id,
            payment_status, payment_confirmed_at, description
          ) VALUES ($1, 'purchase', $2, $3, $4, $5, 'pix', $6, 'confirmed', NOW(), $7)
        `, [
          req.session.userId,
          pendingPurchase.credits_to_add,
          currentCredits,
          newCredits,
          pendingPurchase.amount_requested,
          pendingPurchase.cora_charge_id,
          `Recarga via PIX - ${parseFloat(pendingPurchase.credits_to_add).toFixed(1)} créditos`
        ])
        
        await query('COMMIT')
        
        console.log(`✅ Pagamento confirmado! User ${req.session.userId} recebeu ${pendingPurchase.credits_to_add} créditos`)
        
        return res.json({ 
          success: true, 
          status: 'paid', 
          paid_at: invoiceStatus.paid_at,
          credits_added: parseFloat(pendingPurchase.credits_to_add),
          new_balance: newCredits
        })
      } catch (error) {
        await query('ROLLBACK')
        console.error('❌ Erro ao processar pagamento:', error)
        return res.status(500).json({ 
          success: false, 
          error: 'Erro ao creditar valor' 
        })
      }
    }
    
    // Status ainda pendente
    res.json({ 
      success: true, 
      status: invoiceStatus.status.toLowerCase(),
      message: 'Aguardando pagamento'
    })
    
  } catch (error) {
    console.error('❌ Erro ao verificar pagamento:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao verificar status do pagamento' 
    })
  }
})

// GET /api/credits/pending-purchases - Listar recargas pendentes
router.get('/pending-purchases', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        id, amount_requested, credits_to_add, status,
        pix_qr_code, pix_copy_paste, expires_at, created_at
      FROM pending_credit_purchases
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `, [req.session.userId])
    
    res.json({ 
      success: true,
      pending_purchases: result.rows 
    })
  } catch (error) {
    console.error('Erro ao buscar recargas pendentes:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar recargas pendentes' 
    })
  }
})

// PATCH /api/credits/update-cpf - Atualizar CPF do usuário
router.patch('/update-cpf', requireAuth, async (req, res) => {
  try {
    const { cpf } = req.body
    
    if (!cpf) {
      return res.status(400).json({ 
        success: false, 
        error: 'CPF é obrigatório' 
      })
    }
    
    // Limpar CPF (remover pontos e traços)
    const cleanCpf = cpf.replace(/\D/g, '')
    
    // Validar tamanho
    if (cleanCpf.length !== 11) {
      return res.status(400).json({ 
        success: false, 
        error: 'CPF inválido' 
      })
    }
    
    // Verificar se CPF já está em uso
    const existingCpf = await query(
      'SELECT id FROM users WHERE cpf = $1 AND id != $2',
      [cleanCpf, req.session.userId]
    )
    
    if (existingCpf.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'CPF já cadastrado por outro usuário' 
      })
    }
    
    // Atualizar CPF
    await query(
      'UPDATE users SET cpf = $1, updated_at = NOW() WHERE id = $2',
      [cleanCpf, req.session.userId]
    )
    
    console.log(`✅ CPF atualizado para usuário ${req.session.userId}`)
    
    res.json({ 
      success: true,
      message: 'CPF atualizado com sucesso' 
    })
  } catch (error) {
    console.error('Erro ao atualizar CPF:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao atualizar CPF' 
    })
  }
})

module.exports = router