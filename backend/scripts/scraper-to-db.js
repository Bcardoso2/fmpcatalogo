require('dotenv').config()
const axios = require('axios')
const { query } = require('../config/database')

class DealersClubScraperDB {
  constructor() {
    this.baseURL = "https://prod-backend.dealersclub.com.br/api/v1"
    this.authToken = null
    this.stats = {
      total: 0,
      inserted: 0,
      updated: 0,
      errors: 0
    }
  }

  async login() {
    try {
      console.log("🔐 Fazendo login...")
      
      const response = await axios.post(
        `${this.baseURL}/login`,
        {
          email: process.env.DEALERS_EMAIL,
          password: process.env.DEALERS_PASSWORD,
          whitelabel_origin_id: 8,
        },
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json",
            Referer: "https://vendadireta.dealersclub.com.br/",
          },
        },
      )

      if (response.data?.results?.token) {
        this.authToken = response.data.results.token
        console.log("✅ Login realizado com sucesso!")
        return true
      }

      throw new Error("Login falhou")
    } catch (error) {
      console.error("❌ Erro no login:", error.message)
      return false
    }
  }

  async getVehiclesList() {
    try {
      console.log("📋 Buscando veículos...")

      const response = await axios.get(
        `${this.baseURL}/jornada-compra/anuncios/veiculos/lista-veiculos?sorts=mais_recentes&whitelabel_id=8`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            Accept: "application/json, text/plain, */*",
            Origin: "https://vendadireta.dealersclub.com.br",
            Referer: "https://vendadireta.dealersclub.com.br/",
          },
        },
      )

      if (response.data && Array.isArray(response.data)) {
        // Filtrar apenas veículos ativos
        const activeVehicles = response.data.filter(vehicle => {
          const eventName = vehicle.event?.name?.toLowerCase() || ''
          const isInactive = eventName.includes('cancelado') || eventName.includes('encerrado')
          return !isInactive
        })

        console.log(`✅ ${activeVehicles.length} veículos ativos encontrados`)
        return activeVehicles
      }

      return []
    } catch (error) {
      console.error("❌ Erro ao buscar veículos:", error.message)
      return []
    }
  }

  async saveVehicleToDB(vehicleItem) {
    try {
      const vehicle = vehicleItem.vehicle
      const shop = vehicleItem.shop
      const shopStock = vehicleItem.shop_stock
      const negotiation = vehicleItem.negotiation

      // Processar imagens
      const images = vehicle.image_gallery?.map((img) => ({
        url: img.image,
        thumb: img.thumb,
        order: img.order,
      })) || []

      // Extrair laudo
      let laudoPdfUrl = null
      if (vehicle.precautionary_report) {
        const possibleUrls = [
          vehicle.precautionary_report.file_url,
          vehicle.precautionary_report.pdf_url,
          vehicle.precautionary_report.report_url,
        ]
        
        for (const url of possibleUrls) {
          if (url && url.startsWith('http')) {
            laudoPdfUrl = url
            break
          }
        }
      }

      const laudoStatus = vehicle.precautionary_report?.situation?.toLowerCase() || 'sem_laudo'

      // Verificar se já existe
      const existingResult = await query(
        'SELECT id FROM vehicles WHERE external_id = $1',
        [vehicleItem.id.toString()]
      )

      const vehicleData = {
        external_id: vehicleItem.id.toString(),
        title: `${vehicle.brand_name} ${vehicle.model_name} ${vehicle.manufacture_year}`,
        brand: vehicle.brand_name,
        model: vehicle.model_name,
        year: vehicle.manufacture_year,
        price: negotiation?.value_actual || 0,
        fipe_price: null,
        fipe_confidence: null,
        mileage: vehicle.km || 0,
        fuel_type: vehicle.fuel_name,
        transmission: vehicle.drive_shift_name,
        color: vehicle.color_name,
        description: vehicle.description,
        location: `${shopStock?.city || 'N/A'}, ${shopStock?.state || 'N/A'}`,
        dealer_name: shop?.name,
        dealer_phone: shopStock?.comercial_phone,
        images: JSON.stringify(images),
        laudo_status: laudoStatus,
        laudo_url: laudoPdfUrl,
        laudo_file_url: laudoPdfUrl,
        vehicle_data: JSON.stringify(vehicleItem),
        ai_classification: JSON.stringify({}),
        is_active: true,
        batch_date: new Date().toISOString().split('T')[0]
      }

      if (existingResult.rows.length > 0) {
        // Update
        await query(`
          UPDATE vehicles SET
            title = $1, brand = $2, model = $3, year = $4, price = $5,
            mileage = $6, fuel_type = $7, transmission = $8, color = $9,
            description = $10, location = $11, dealer_name = $12, dealer_phone = $13,
            images = $14, laudo_status = $15, laudo_url = $16, laudo_file_url = $17,
            vehicle_data = $18, updated_at = NOW()
          WHERE external_id = $19
        `, [
          vehicleData.title, vehicleData.brand, vehicleData.model, vehicleData.year,
          vehicleData.price, vehicleData.mileage, vehicleData.fuel_type, vehicleData.transmission,
          vehicleData.color, vehicleData.description, vehicleData.location, vehicleData.dealer_name,
          vehicleData.dealer_phone, vehicleData.images, vehicleData.laudo_status,
          vehicleData.laudo_url, vehicleData.laudo_file_url, vehicleData.vehicle_data,
          vehicleData.external_id
        ])
        
        this.stats.updated++
        console.log(`🔄 Atualizado: ${vehicleData.title}`)
      } else {
        // Insert
        await query(`
          INSERT INTO vehicles (
            external_id, title, brand, model, year, price, mileage,
            fuel_type, transmission, color, description, location,
            dealer_name, dealer_phone, images, laudo_status, laudo_url,
            laudo_file_url, vehicle_data, ai_classification, is_active, batch_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        `, [
          vehicleData.external_id, vehicleData.title, vehicleData.brand, vehicleData.model,
          vehicleData.year, vehicleData.price, vehicleData.mileage, vehicleData.fuel_type,
          vehicleData.transmission, vehicleData.color, vehicleData.description, vehicleData.location,
          vehicleData.dealer_name, vehicleData.dealer_phone, vehicleData.images, vehicleData.laudo_status,
          vehicleData.laudo_url, vehicleData.laudo_file_url, vehicleData.vehicle_data,
          vehicleData.ai_classification, vehicleData.is_active, vehicleData.batch_date
        ])
        
        this.stats.inserted++
        console.log(`➕ Inserido: ${vehicleData.title}`)
      }

    } catch (error) {
      this.stats.errors++
      console.error(`❌ Erro ao salvar veículo:`, error.message)
    }
  }

  async run() {
    console.log("🚀 Iniciando scraper para PostgreSQL...\n")

    const loginSuccess = await this.login()
    if (!loginSuccess) {
      console.error("❌ Falha no login")
      process.exit(1)
    }

    const vehicles = await this.getVehiclesList()
    this.stats.total = vehicles.length

    console.log(`\n📊 Processando ${vehicles.length} veículos...\n`)

    for (const vehicle of vehicles) {
      await this.saveVehicleToDB(vehicle)
      await new Promise(resolve => setTimeout(resolve, 500)) // Delay entre veículos
    }

    console.log("\n✅ Scraping concluído!")
    console.log(`📈 Estatísticas:`)
    console.log(`   Total: ${this.stats.total}`)
    console.log(`   Inseridos: ${this.stats.inserted}`)
    console.log(`   Atualizados: ${this.stats.updated}`)
    console.log(`   Erros: ${this.stats.errors}`)

    process.exit(0)
  }
}

// Executar
const scraper = new DealersClubScraperDB()
scraper.run().catch(console.error)