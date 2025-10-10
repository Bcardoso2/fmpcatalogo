const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : { rejectUnauthorized: false }, // SSL também no local
  max: 10,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // IMPORTANTE: Adicione statement timeout
  statement_timeout: 60000 // 60 segundos por query
})

pool.on('error', (err) => {
  console.error('Erro no pool:', err)
})

async function query(text, params) {
  const client = await pool.connect()
  try {
    const res = await client.query(text, params)
    return res
  } catch (error) {
    console.error('Erro na query:', error.message)
    throw error
  } finally {
    client.release()
  }
}

module.exports = { query, pool }