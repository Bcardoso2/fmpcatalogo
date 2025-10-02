require('dotenv').config()
const { query } = require('../config/database')

async function deactivateVehicles() {
  try {
    console.log(`[${new Date().toISOString()}] Iniciando desativação de veículos...`)

    const result = await query(`
      UPDATE vehicles
      SET 
        is_active = false,
        deactivated_at = NOW()
      WHERE 
        is_active = true 
        AND has_winning_proposal = false
        AND batch_date < CURRENT_DATE
      RETURNING id, external_id, title
    `)

    console.log(`✅ ${result.rows.length} veículos desativados`)
    
    if (result.rows.length > 0) {
      console.log('Veículos desativados:')
      result.rows.forEach(v => {
        console.log(`  - ${v.title} (ID: ${v.external_id})`)
      })
    }
    
    process.exit(0)
  } catch (error) {
    console.error('❌ Erro ao desativar veículos:', error.message)
    process.exit(1)
  }
}

deactivateVehicles()