require('dotenv').config()
const coraService = require('./services/coraService')

async function testCreateInvoice() {
  console.log('=== TESTE DE CRIAÇÃO DE QR CODE PIX (PRODUÇÃO) ===\n')
  console.log('⚠️  ATENÇÃO: Isso vai gerar uma cobrança REAL!\n')
  
  const authSuccess = await coraService.authenticate()
  if (!authSuccess) {
    console.log('❌ Falha na autenticação')
    return
  }
  
  console.log('\nCriando invoice REAL...\n')
  
  const result = await coraService.createPixInvoice(
    {
      name: 'João Silva Teste',
      email: 'teste@email.com',
      cpf: '00413684288'
    },
    10.00, // R$ 10,00
    'Teste de recarga de créditos'
  )
  
  if (result.success) {
    console.log('\n✅ QR CODE GERADO!\n')
    console.log('Invoice ID:', result.invoice_id)
    console.log('Status:', result.status)
    console.log('Valor:', 'R$', result.total_amount.toFixed(2))
    console.log('Vencimento:', result.due_date)
    console.log('PIX Copia e Cola:', result.qr_code_emv)
    console.log('URL QR Code:', result.qr_code_url)
  } else {
    console.log('\n❌ ERRO\n')
    console.log('Erro:', result.error)
  }
}

testCreateInvoice()