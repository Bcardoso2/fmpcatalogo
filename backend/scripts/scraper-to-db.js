require('dotenv').config()
const axios = require('axios')
const { query } = require('../config/database')

class DealersClubScraper {
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
        console.log("✅ Login realizado!\n")
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
      console.log("📋 Buscando veículos...\n")

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
        const activeVehicles = response.data.filter(vehicle => {
          const eventName = vehicle.event?.name?.toLowerCase() || ''
          return !eventName.includes('cancelado') && !eventName.includes('encerrado')
        })

        console.log(`✅ ${activeVehicles.length} veículos ativos\n`)
        return activeVehicles
      }

      return []
    } catch (error) {
      console.error("❌ Erro ao buscar veículos:", error.message)
      return []
    }
  }

  detectCategory(vehicleItem) {
    const eventName = (vehicleItem.event?.name || '').toLowerCase()
    const categoryName = (vehicleItem.vehicle?.category_name || '').toLowerCase()
    const brandName = (vehicleItem.vehicle?.brand_name || '').toLowerCase()
    const modelName = (vehicleItem.vehicle?.model_name || '').toLowerCase()
    
    if (categoryName.includes('automovel') || categoryName.includes('automóvel')) {
      return 'Carro'
    }
    
    if (categoryName.includes('utilitario') || categoryName.includes('utilitário')) {
      return 'Carro'
    }
    
    if (categoryName.includes('caminhao') || categoryName.includes('caminhão')) {
      return 'Caminhão'
    }
    
    if (categoryName.includes('motocicleta') || categoryName.includes('moto')) {
      return 'Moto'
    }
    
    if (categoryName.includes('reboque') || categoryName.includes('implemento')) {
      return 'Implemento'
    }
    
    if (eventName.includes('pesados') || eventName.includes('pesado')) {
      const implementoBrands = ['randon', 'librelato', 'facchini', 'guerra', 'noma']
      if (implementoBrands.includes(brandName)) {
        return 'Implemento'
      }
      return 'Caminhão'
    }
    
    const caminhoesBrands = ['scania', 'volvo', 'mercedes-benz', 'iveco', 'man', 'ford cargo']
    if (caminhoesBrands.includes(brandName)) {
      if (/(\d{2,4}[-\s]?\d{2,4}|FH|FM|NH|Actros|Atego|Axor)/.test(modelName)) {
        return 'Caminhão'
      }
    }
    
    if (brandName === 'volkswagen') {
      if (/\d{2,4}[-\s]\d{2,4}/.test(modelName)) {
        return 'Caminhão'
      }
    }
    
    const motoOnlyBrands = ['honda', 'yamaha', 'suzuki', 'kawasaki', 'harley', 'harley-davidson', 'ducati', 'triumph', 'royal enfield', 'ktm']
    if (motoOnlyBrands.includes(brandName)) {
      return 'Moto'
    }
    
    if (brandName === 'bmw') {
      const motoModelsBMW = ['g 310', 'f 850', 'r 1250', 's 1000', 'k 1600', 'c 400', 'f 900']
      if (motoModelsBMW.some(m => modelName.includes(m))) {
        return 'Moto'
      }
      return 'Carro'
    }
    
    if (eventName.includes('leves') || eventName.includes('leve')) {
      return 'Carro'
    }
    
    return 'Carro'
  }

  extractEventDate(vehicleItem) {
    const eventName = vehicleItem.event?.name || ''
    const dateMatch = eventName.match(/(\d{2})\.(\d{2})\.(\d{4})/)
    
    if (dateMatch) {
      const [_, day, month, year] = dateMatch
      return `${year}-${month}-${day}`
    }
    
    return null
  }

  cleanDescription(description) {
    if (!description) return ''
    
    let cleaned = description
    cleaned = cleaned.replace(/RETIRADA MEDIANTE A AGENDAMENTO PREVIO NO E-MAIL \(operacoes@dealerslcub\.com\.br\)/gi, '')
    cleaned = cleaned.replace(/dealersclub/gi, '')
    cleaned = cleaned.replace(/dealers club/gi, '')
    cleaned = cleaned.replace(/dealers_club/gi, '')
    cleaned = cleaned.replace(/\s+/g, ' ').trim()
    
    return cleaned
  }

  async saveVehicleToDB(vehicleItem) {
    try {
      const vehicle = vehicleItem.vehicle
      const shop = vehicleItem.shop
      const shopStock = vehicleItem.shop_stock
      const negotiation = vehicleItem.negotiation

      const category = this.detectCategory(vehicleItem)
      const eventDate = this.extractEventDate(vehicleItem)
      const year = vehicle.model_year || vehicle.manufacture_year

      console.log(`   📋 ${vehicle.brand_name} ${vehicle.model_name} ${year} [${category}]`)

      const images = vehicle.image_gallery?.map((img) => ({
        url: img.image,
        thumb: img.thumb,
        order: img.order,
      })) || []

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
      const cleanedDescription = this.cleanDescription(vehicle.description)
      const mileage = vehicle.km || vehicle.mileage || 0

      const existingResult = await query(
        'SELECT id FROM vehicles WHERE external_id = $1',
        [vehicleItem.id.toString()]
      )

      const vehicleData = {
        external_id: vehicleItem.id.toString(),
        title: `${vehicle.brand_name} ${vehicle.model_name} ${year}`,
        brand: vehicle.brand_name,
        model: vehicle.model_name,
        year: year,
        price: negotiation?.value_actual || 0,
        mileage: mileage,
        fuel_type: vehicle.fuel_name,
        transmission: vehicle.drive_shift_name,
        color: vehicle.color_name,
        description: cleanedDescription,
        category: category,
        event_date: eventDate,
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
        await query(`
          UPDATE vehicles SET
            title = $1, brand = $2, model = $3, year = $4, price = $5,
            mileage = $6, fuel_type = $7, transmission = $8, color = $9, 
            description = $10, category = $11, event_date = $12, location = $13, 
            dealer_name = $14, dealer_phone = $15, images = $16, laudo_status = $17, 
            laudo_url = $18, laudo_file_url = $19, vehicle_data = $20, updated_at = NOW()
          WHERE external_id = $21
        `, [
          vehicleData.title, vehicleData.brand, vehicleData.model, vehicleData.year,
          vehicleData.price, vehicleData.mileage, vehicleData.fuel_type, 
          vehicleData.transmission, vehicleData.color, vehicleData.description, 
          vehicleData.category, vehicleData.event_date, vehicleData.location, 
          vehicleData.dealer_name, vehicleData.dealer_phone, vehicleData.images, 
          vehicleData.laudo_status, vehicleData.laudo_url, vehicleData.laudo_file_url, 
          vehicleData.vehicle_data, vehicleData.external_id
        ])
        
        this.stats.updated++
        console.log(`   ✅ Atualizado\n`)
      } else {
        await query(`
          INSERT INTO vehicles (
            external_id, title, brand, model, year, price, mileage, fuel_type, 
            transmission, color, description, category, event_date, location, 
            dealer_name, dealer_phone, images, laudo_status, laudo_url, 
            laudo_file_url, vehicle_data, ai_classification, is_active, batch_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 
                    $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        `, [
          vehicleData.external_id, vehicleData.title, vehicleData.brand, vehicleData.model,
          vehicleData.year, vehicleData.price, vehicleData.mileage, vehicleData.fuel_type, 
          vehicleData.transmission, vehicleData.color, vehicleData.description, 
          vehicleData.category, vehicleData.event_date, vehicleData.location, 
          vehicleData.dealer_name, vehicleData.dealer_phone, vehicleData.images, 
          vehicleData.laudo_status, vehicleData.laudo_url, vehicleData.laudo_file_url, 
          vehicleData.vehicle_data, vehicleData.ai_classification, vehicleData.is_active, 
          vehicleData.batch_date
        ])
        
        this.stats.inserted++
        console.log(`   ✅ Inserido\n`)
      }

    } catch (error) {
      this.stats.errors++
      console.error(`   ❌ Erro:`, error.message)
    }
  }

  async run() {
    console.log("🚀 Iniciando scraper...\n")

    const loginSuccess = await this.login()
    if (!loginSuccess) {
      console.error("Falha no login")
      process.exit(1)
    }

    const vehicles = await this.getVehiclesList()
    this.stats.total = vehicles.length

    console.log(`📊 Processando ${vehicles.length} veículos...\n`)

    for (const vehicle of vehicles) {
      await this.saveVehicleToDB(vehicle)
    }

    console.log("\n" + "=".repeat(70))
    console.log("📊 SCRAPING CONCLUÍDO!")
    console.log("=".repeat(70))
    console.log(`\n📈 Estatísticas:`)
    console.log(`   Total processado: ${this.stats.total}`)
    console.log(`   Inseridos: ${this.stats.inserted}`)
    console.log(`   Atualizados: ${this.stats.updated}`)
    console.log(`   Erros: ${this.stats.errors}`)
    console.log("")

    process.exit(0)
  }
}

const scraper = new DealersClubScraper()
scraper.run().catch(console.error)