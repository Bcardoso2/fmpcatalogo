const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('connect', () => {
  console.log('✅ Conectado ao PostgreSQL')
})

pool.on('error', (err) => {
  console.error('❌ Erro no PostgreSQL:', err)
})

async function query(text, params) {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    console.log('Query executada:', { text, duration, rows: res.rowCount })
    return res
  } catch (error) {
    console.error('Erro na query:', error)
    throw error
  }
}

module.exports = { pool, query }