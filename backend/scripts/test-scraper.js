require('dotenv').config()
const axios = require('axios')
const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')

class DealersClubFipePreview {
  constructor() {
    this.baseURL = "https://prod-backend.dealersclub.com.br/api/v1"
    this.authToken = null
    this.results = []
    this.stats = {
      total: 0,
      fipe_success: 0,
      fipe_errors: 0,
      fipe_via_placa: 0,
      fipe_via_api: 0
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

  async getVehiclesList(limit = 50) {
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
        const activeVehicles = response.data
          .filter(vehicle => {
            const eventName = vehicle.event?.name?.toLowerCase() || ''
            return !eventName.includes('cancelado') && !eventName.includes('encerrado')
          })
          .slice(0, limit)

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
    
    if (categoryName.includes('automovel') || categoryName.includes('automóvel')) return 'Carro'
    if (categoryName.includes('utilitario') || categoryName.includes('utilitário')) return 'Carro'
    if (categoryName.includes('caminhao') || categoryName.includes('caminhão')) return 'Caminhão'
    if (categoryName.includes('motocicleta') || categoryName.includes('moto')) return 'Moto'
    if (categoryName.includes('reboque') || categoryName.includes('implemento')) return 'Implemento'
    
    if (eventName.includes('pesados') || eventName.includes('pesado')) {
      const implementoBrands = ['randon', 'librelato', 'facchini', 'guerra', 'noma']
      if (implementoBrands.includes(brandName)) return 'Implemento'
      return 'Caminhão'
    }
    
    const caminhoesBrands = ['scania', 'volvo', 'mercedes-benz', 'iveco', 'man', 'ford cargo']
    if (caminhoesBrands.includes(brandName)) {
      if (/(\d{2,4}[-\s]?\d{2,4}|FH|FM|NH|Actros|Atego|Axor)/.test(modelName)) return 'Caminhão'
    }
    
    if (brandName === 'volkswagen' && /\d{2,4}[-\s]\d{2,4}/.test(modelName)) return 'Caminhão'
    
    const motoOnlyBrands = ['honda', 'yamaha', 'suzuki', 'kawasaki', 'harley', 'harley-davidson', 'ducati', 'triumph', 'royal enfield', 'ktm']
    if (motoOnlyBrands.includes(brandName)) return 'Moto'
    
    if (brandName === 'bmw') {
      const motoModelsBMW = ['g 310', 'f 850', 'r 1250', 's 1000', 'k 1600', 'c 400', 'f 900']
      if (motoModelsBMW.some(m => modelName.includes(m))) return 'Moto'
      return 'Carro'
    }
    
    if (eventName.includes('leves') || eventName.includes('leve')) return 'Carro'
    
    return 'Carro'
  }

  async consultarFipePorPlaca(placa, tentativa = 1, maxTentativas = 2) {
    let browser
    try {
      if (tentativa > 1) {
        console.log(`      🔄 Tentativa ${tentativa}/${maxTentativas}...`)
      } else {
        console.log(`      🔍 Consultando FIPE pela placa ${placa}...`)
      }
      
      const placaLimpa = placa.replace(/[-\s]/g, '').toUpperCase()
      const url = `https://placafipe.com/placa/${placaLimpa}`
      
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })
      
      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
      await page.waitForSelector('table.fipeTablePriceDetail', { timeout: 30000 })
      
      const dados = await page.evaluate(() => {
        const result = { modelosFIPE: [] }
        
        const fipeRows = document.querySelectorAll('table.fipe-desktop tr')
        fipeRows.forEach((row, i) => {
          if (i === 0) return
          
          const codigo = row.querySelector('td:nth-child(1)')?.textContent?.trim()
          const modelo = row.querySelector('td:nth-child(2)')?.textContent?.trim()
          const valor = row.querySelector('td:nth-child(3)')?.textContent?.trim()
          
          if (codigo && modelo && valor) {
            result.modelosFIPE.push({ codigo_fipe: codigo, modelo_fipe: modelo, valor_texto: valor })
          }
        })
        
        if (result.modelosFIPE.length === 0) {
          let currentModelo = {}
          const mobileRows = document.querySelectorAll('table.fipe-mobile tr')
          
          mobileRows.forEach(row => {
            const text = row.textContent.trim()
            
            if (text.startsWith('FIPE:')) {
              if (currentModelo.codigo_fipe) result.modelosFIPE.push(currentModelo)
              currentModelo = { codigo_fipe: text.replace('FIPE:', '').trim() }
            } else if (text.startsWith('Modelo:')) {
              currentModelo.modelo_fipe = text.replace('Modelo:', '').trim()
            } else if (text.startsWith('Valor:')) {
              currentModelo.valor_texto = text.replace('Valor:', '').trim()
            }
          })
          
          if (currentModelo.codigo_fipe) result.modelosFIPE.push(currentModelo)
        }
        
        return result
      })
      
      await browser.close()
      
      if (dados.modelosFIPE.length > 0) {
        dados.modelosFIPE = dados.modelosFIPE.map(m => ({
          ...m,
          valor_fipe: parseFloat(m.valor_texto.replace('R$ ', '').replace(/\./g, '').replace(',', '.'))
        }))
        
        const soma = dados.modelosFIPE.reduce((acc, m) => acc + m.valor_fipe, 0)
        const media = soma / dados.modelosFIPE.length
        
        console.log(`      ✅ FIPE: R$ ${media.toLocaleString('pt-BR', {minimumFractionDigits: 2})} (${dados.modelosFIPE.length} versões)`)
        
        return {
          fipe_price: media,
          fipe_code: dados.modelosFIPE[0].codigo_fipe,
          fipe_confidence: 'high',
          fonte: 'PlacaFipe'
        }
      }
      
      return null
      
    } catch (error) {
      if (browser) await browser.close()
      
      if (tentativa < maxTentativas) {
        const waitTime = tentativa * 5000
        console.log(`      ⚠️ Erro: ${error.message}`)
        console.log(`      ⏳ Aguardando ${waitTime/1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        return this.consultarFipePorPlaca(placa, tentativa + 1, maxTentativas)
      }
      
      console.log(`      ❌ Falhou após ${maxTentativas} tentativas`)
      return null
    }
  }

  async consultarFipeAPI(marca, modelo, ano) {
    try {
      console.log(`      🔄 Tentando FIPE API...`)
      
      const marcaMap = {
        'volkswagen': 'VW',
        'chevrolet': 'GM',
        'land rover': 'Land Rover',
        'mercedes-benz': 'Mercedes-Benz'
      }
      
      const marcaNormalizada = marcaMap[marca.toLowerCase()] || marca
      
      const marcasResponse = await axios.get('https://parallelum.com.br/fipe/api/v1/carros/marcas', { timeout: 10000 })
      
      const marcaObj = marcasResponse.data.find(m => {
        const nomeMarca = m.nome.toLowerCase()
        const buscaMarca = marcaNormalizada.toLowerCase()
        return nomeMarca.includes(buscaMarca) || buscaMarca.includes(nomeMarca)
      })
      
      if (!marcaObj) return null
      
      const modelosResponse = await axios.get(
        `https://parallelum.com.br/fipe/api/v1/carros/marcas/${marcaObj.codigo}/modelos`,
        { timeout: 10000 }
      )
      
      let modeloObj = modelosResponse.data.modelos.find(m => m.nome.toLowerCase().includes(modelo.toLowerCase()))
      
      if (!modeloObj) {
        const primeiraPalavra = modelo.split(' ')[0].toLowerCase()
        modeloObj = modelosResponse.data.modelos.find(m => m.nome.toLowerCase().startsWith(primeiraPalavra))
      }
      
      if (!modeloObj) return null
      
      const anosResponse = await axios.get(
        `https://parallelum.com.br/fipe/api/v1/carros/marcas/${marcaObj.codigo}/modelos/${modeloObj.codigo}/anos`,
        { timeout: 10000 }
      )
      
      let anoObj = anosResponse.data.find(a => a.nome.includes(ano.toString()))
      if (!anoObj && anosResponse.data.length > 0) anoObj = anosResponse.data[0]
      if (!anoObj) return null
      
      const fipeResponse = await axios.get(
        `https://parallelum.com.br/fipe/api/v1/carros/marcas/${marcaObj.codigo}/modelos/${modeloObj.codigo}/anos/${anoObj.codigo}`,
        { timeout: 10000 }
      )
      
      const valor = parseFloat(fipeResponse.data.Valor.replace('R$ ', '').replace(/\./g, '').replace(',', '.'))
      
      console.log(`      ✅ FIPE API: R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`)
      
      return {
        fipe_price: valor,
        fipe_code: fipeResponse.data.CodigoFipe,
        fipe_confidence: 'medium',
        fonte: 'FIPE API'
      }
      
    } catch (error) {
      console.log(`      ⚠️ FIPE API falhou`)
      return null
    }
  }

  async consultarFipeCompleto(vehicle) {
    let fipeData = null
    
    if (vehicle.plate) {
      fipeData = await this.consultarFipePorPlaca(vehicle.plate)
      if (fipeData) this.stats.fipe_via_placa++
    }
    
    if (!fipeData && vehicle.brand_name && vehicle.model_name) {
      const ano = vehicle.model_year || vehicle.manufacture_year
      fipeData = await this.consultarFipeAPI(vehicle.brand_name, vehicle.model_name, ano)
      if (fipeData) this.stats.fipe_via_api++
    }
    
    return fipeData
  }

  async processVehicle(vehicleItem) {
    try {
      const vehicle = vehicleItem.vehicle
      const negotiation = vehicleItem.negotiation
      const category = this.detectCategory(vehicleItem)
      const year = vehicle.model_year || vehicle.manufacture_year
      
      console.log(`   📋 ${vehicle.brand_name} ${vehicle.model_name} ${year} [${category}]`)
      
      let fipeData = { fipe_price: null, fipe_confidence: null, fonte: 'N/A' }
      
      if (category === 'Carro') {
        const fipeResult = await this.consultarFipeCompleto(vehicle)
        
        if (fipeResult) {
          fipeData = fipeResult
          this.stats.fipe_success++
        } else {
          this.stats.fipe_errors++
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000))
      }

      const price = negotiation?.value_actual || 0
      let desconto = null
      let economia = null
      let status = 'sem-fipe'
      
      if (fipeData.fipe_price) {
        desconto = ((fipeData.fipe_price - price) / fipeData.fipe_price * 100).toFixed(1)
        economia = (fipeData.fipe_price - price).toFixed(2)
        
        if (price < fipeData.fipe_price * 0.85) {
          status = 'excelente'
        } else if (price < fipeData.fipe_price * 0.95) {
          status = 'bom'
        } else if (price > fipeData.fipe_price * 1.1) {
          status = 'caro'
        } else {
          status = 'justo'
        }
      }

      this.results.push({
        id: vehicleItem.id,
        title: `${vehicle.brand_name} ${vehicle.model_name} ${year}`,
        brand: vehicle.brand_name,
        model: vehicle.model_name,
        year: year,
        category: category,
        plate: vehicle.plate || 'N/A',
        price: price,
        fipe_price: fipeData.fipe_price,
        fipe_confidence: fipeData.fipe_confidence,
        fipe_fonte: fipeData.fonte,
        desconto: desconto,
        economia: economia,
        status: status,
        location: `${vehicleItem.shop_stock?.city || 'N/A'}, ${vehicleItem.shop_stock?.state || 'N/A'}`,
        image: vehicle.image_gallery?.[0]?.thumb || vehicle.image_gallery?.[0]?.image || ''
      })

      console.log(`   ✅ Processado\n`)

    } catch (error) {
      console.error(`   ❌ Erro:`, error.message)
    }
  }

  generateHTML() {
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview FIPE - DealersClub</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: #f5f5f5;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        
        .header {
            background: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .header h1 { color: #333; margin-bottom: 10px; }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .stat-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #007bff;
        }
        .stat-label { font-size: 12px; color: #666; margin-bottom: 5px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #333; }
        
        .filters {
            background: white;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .filter-group {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            align-items: center;
        }
        .filter-group label { font-weight: 500; }
        .filter-group select, .filter-group input {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .vehicles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        
        .vehicle-card {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .vehicle-card:hover { transform: translateY(-4px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        
        .vehicle-image {
            width: 100%;
            height: 200px;
            object-fit: cover;
            background: #eee;
        }
        
        .vehicle-content { padding: 20px; }
        .vehicle-title {
            font-size: 18px;
            font-weight: 600;
            color: #333;
            margin-bottom: 8px;
        }
        .vehicle-info {
            font-size: 13px;
            color: #666;
            margin-bottom: 5px;
        }
        
        .price-section {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #eee;
        }
        .price {
            font-size: 24px;
            font-weight: bold;
            color: #28a745;
            margin-bottom: 5px;
        }
        .fipe-info {
            font-size: 13px;
            color: #666;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            margin-right: 5px;
            margin-bottom: 5px;
        }
        .badge-excelente { background: #d4edda; color: #155724; }
        .badge-bom { background: #d1ecf1; color: #0c5460; }
        .badge-justo { background: #fff3cd; color: #856404; }
        .badge-caro { background: #f8d7da; color: #721c24; }
        .badge-sem-fipe { background: #e2e3e5; color: #383d41; }
        .badge-high { background: #d4edda; color: #155724; }
        .badge-medium { background: #fff3cd; color: #856404; }
        
        .no-results {
            text-align: center;
            padding: 60px;
            background: white;
            border-radius: 12px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚗 Preview FIPE - DealersClub</h1>
            <p>Análise de preços gerada em ${new Date().toLocaleString('pt-BR')}</p>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-label">Total de Veículos</div>
                    <div class="stat-value">${this.stats.total}</div>
                </div>
                <div class="stat-card" style="border-color: #28a745;">
                    <div class="stat-label">FIPE Encontrada</div>
                    <div class="stat-value">${this.stats.fipe_success}</div>
                </div>
                <div class="stat-card" style="border-color: #dc3545;">
                    <div class="stat-label">FIPE Não Encontrada</div>
                    <div class="stat-value">${this.stats.fipe_errors}</div>
                </div>
                <div class="stat-card" style="border-color: #17a2b8;">
                    <div class="stat-label">Taxa de Sucesso</div>
                    <div class="stat-value">${((this.stats.fipe_success/this.stats.total)*100).toFixed(1)}%</div>
                </div>
                <div class="stat-card" style="border-color: #6610f2;">
                    <div class="stat-label">Via Placa</div>
                    <div class="stat-value">${this.stats.fipe_via_placa}</div>
                </div>
                <div class="stat-card" style="border-color: #fd7e14;">
                    <div class="stat-label">Via API</div>
                    <div class="stat-value">${this.stats.fipe_via_api}</div>
                </div>
            </div>
        </div>

        <div class="filters">
            <div class="filter-group">
                <label>Filtrar por status:</label>
                <select id="statusFilter" onchange="filterVehicles()">
                    <option value="all">Todos</option>
                    <option value="excelente">Excelente</option>
                    <option value="bom">Bom</option>
                    <option value="justo">Justo</option>
                    <option value="caro">Caro</option>
                    <option value="sem-fipe">Sem FIPE</option>
                </select>
                
                <label>Categoria:</label>
                <select id="categoryFilter" onchange="filterVehicles()">
                    <option value="all">Todas</option>
                    <option value="Carro">Carro</option>
                    <option value="Caminhão">Caminhão</option>
                    <option value="Moto">Moto</option>
                    <option value="Implemento">Implemento</option>
                </select>
                
                <label>Buscar:</label>
                <input type="text" id="searchInput" placeholder="Marca, modelo..." onkeyup="filterVehicles()">
            </div>
        </div>

        <div class="vehicles-grid" id="vehiclesGrid">
            ${this.results.map(v => `
                <div class="vehicle-card" data-status="${v.status}" data-category="${v.category}">
                    ${v.image ? `<img src="${v.image}" class="vehicle-image" alt="${v.title}">` : '<div class="vehicle-image"></div>'}
                    <div class="vehicle-content">
                        <div class="vehicle-title">${v.title}</div>
                        <div class="vehicle-info">📍 ${v.location}</div>
                        <div class="vehicle-info">🏷️ Placa: ${v.plate}</div>
                        <div class="vehicle-info">📦 ${v.category}</div>
                        
                        <div style="margin-top: 10px;">
                            ${v.status === 'excelente' ? '<span class="badge badge-excelente">EXCELENTE</span>' : ''}
                            ${v.status === 'bom' ? '<span class="badge badge-bom">BOM NEGÓCIO</span>' : ''}
                            ${v.status === 'justo' ? '<span class="badge badge-justo">JUSTO</span>' : ''}
                            ${v.status === 'caro' ? '<span class="badge badge-caro">CARO</span>' : ''}
                            ${v.status === 'sem-fipe' ? '<span class="badge badge-sem-fipe">SEM FIPE</span>' : ''}
                            
                            ${v.fipe_confidence === 'high' ? '<span class="badge badge-high">Alta Confiança</span>' : ''}
                            ${v.fipe_confidence === 'medium' ? '<span class="badge badge-medium">Média Confiança</span>' : ''}
                        </div>
                        
                        <div class="price-section">
                            <div class="price">R$ ${v.price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                            ${v.fipe_price ? `
                                <div class="fipe-info">
                                    💰 FIPE: R$ ${v.fipe_price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}<br>
                                    ${v.desconto ? `📊 Desconto: ${v.desconto}%` : ''}<br>
                                    ${v.economia > 0 ? `💵 Economize: R$ ${parseFloat(v.economia).toLocaleString('pt-BR')}` : ''}<br>
                                    🔍 Fonte: ${v.fipe_fonte}
                                </div>
                            ` : '<div class="fipe-info">❌ FIPE não disponível</div>'}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <script>
        function filterVehicles() {
            const statusFilter = document.getElementById('statusFilter').value;
            const categoryFilter = document.getElementById('categoryFilter').value;
            const searchInput = document.getElementById('searchInput').value.toLowerCase();
            const cards = document.querySelectorAll('.vehicle-card');
            
            cards.forEach(card => {
                const status = card.dataset.status;
                const category = card.dataset.category;
                const text = card.textContent.toLowerCase();
                
                const statusMatch = statusFilter === 'all' || status === statusFilter;
                const categoryMatch = categoryFilter === 'all' || category === categoryFilter;
                const searchMatch = searchInput === '' || text.includes(searchInput);
                
                if (statusMatch && categoryMatch && searchMatch) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        }
    </script>
</body>
</html>`

    return html
  }

  async run() {
    console.log("🚀 Iniciando preview FIPE...\n")

    const loginSuccess = await this.login()
    if (!loginSuccess) {
      console.error("Falha no login")
      process.exit(1)
    }

    const limit = parseInt(process.argv[2]) || 50
    const vehicles = await this.getVehiclesList(limit)
    this.stats.total = vehicles.length

    console.log(`📊 Processando ${vehicles.length} veículos...\n`)

    for (const vehicle of vehicles) {
      await this.processVehicle(vehicle)
    }

    console.log("\n" + "=".repeat(70))
    console.log("📊 PROCESSAMENTO CONCLUÍDO!")
    console.log("=".repeat(70))
    console.log(`\n📈 Estatísticas:`)
    console.log(`   Total: ${this.stats.total}`)
    console.log(`   FIPE Sucesso: ${this.stats.fipe_success}`)
    console.log(`   FIPE Erros: ${this.stats.fipe_errors}`)
    console.log(`   Via Placa: ${this.stats.fipe_via_placa}`)
    console.log(`   Via API: ${this.stats.fipe_via_api}`)
    console.log(`   Taxa: ${((this.stats.fipe_success/this.stats.total)*100).toFixed(1)}%`)

    const html = this.generateHTML()
    const outputPath = path.join(__dirname, '../preview-fipe.html')
    fs.writeFileSync(outputPath, html)
    console.log(`\n✅ HTML gerado com sucesso!`)
    console.log(`📄 Arquivo: ${outputPath}`)
    console.log(`🌐 Abra o arquivo no navegador para visualizar`)
    console.log("")

    process.exit(0)
  }
}

const preview = new DealersClubFipePreview()
preview.run().catch(console.error)