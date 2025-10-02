require('dotenv').config()
const coraService = require('./services/coraService')

async function testAuth() {
  console.log('=== TESTE DE AUTENTICAÇÃO CORA ===\n')
  
  const success = await coraService.authenticate()
  
  if (success) {
    console.log('\n✅ SUCESSO! Sistema pronto para usar.')
  } else {
    console.log('\n❌ FALHA! Verifique os certificados e credenciais.')
  }
}

testAuth()