require('dotenv').config()
const bcrypt = require('bcrypt')
const { query } = require('../config/database')

async function createUser(phone, password, name, email, clientId, credits = 0) {
  try {
    const passwordHash = await bcrypt.hash(password, 10)
    
    const result = await query(`
      INSERT INTO users (phone, password_hash, name, email, client_id, credits, role, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, 'viewer', true)
      RETURNING id, phone, name, email, credits, role
    `, [phone, passwordHash, name, email || null, clientId, credits])
    
    console.log('✅ Usuário criado com sucesso:')
    console.log(result.rows[0])
    process.exit(0)
  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error.message)
    process.exit(1)
  }
}

// Executar
const [phone, password, name, email, clientId, credits] = process.argv.slice(2)

if (!phone || !password || !name) {
  console.log('Uso: node create-user.js <telefone> <senha> <nome> [email] [clientId] [creditos]')
  console.log('Exemplo: node create-user.js 11999999999 senha123 "João Silva" joao@email.com client1 10')
  process.exit(1)
}

createUser(
  phone, 
  password, 
  name, 
  email, 
  clientId || 'client1', 
  parseFloat(credits) || 0
)