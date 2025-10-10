require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer'); // npm install puppeteer

// ==========================================
// AUTENTICAÇÃO DEALERSCLUB
// ==========================================

class DealersClubAPI {
  constructor() {
    this.baseURL = "https://prod-backend.dealersclub.com.br/api/v1";
    this.authToken = null;
  }

  async login() {
    try {
      console.log("🔐 Fazendo login no DealersClub...");
      
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
        }
      );

      if (response.data?.results?.token) {
        this.authToken = response.data.results.token;
        console.log("✅ Login realizado com sucesso!\n");
        return true;
      }

      throw new Error("Login falhou");
    } catch (error) {
      console.error("❌ Erro no login:", error.message);
      return false;
    }
  }

  async getVehiclesList(limit = 10) {
    try {
      console.log(`📋 Buscando veículos do DealersClub...\n`);

      const response = await axios.get(
        `${this.baseURL}/jornada-compra/anuncios/veiculos/lista-veiculos?sorts=mais_recentes&whitelabel_id=8`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            Accept: "application/json, text/plain, */*",
            Origin: "https://vendadireta.dealersclub.com.br",
            Referer: "https://vendadireta.dealersclub.com.br/",
          },
        }
      );

      if (response.data && Array.isArray(response.data)) {
        const activeVehicles = response.data
          .filter(vehicle => {
            const eventName = vehicle.event?.name?.toLowerCase() || '';
            return !eventName.includes('cancelado') && !eventName.includes('encerrado');
          })
          .slice(0, limit);

        console.log(`✅ ${activeVehicles.length} veículos encontrados\n`);
        
        console.log('📋 Lista de veículos selecionados:');
        activeVehicles.forEach((v, i) => {
          const cat = v.vehicle?.category_name || 'N/A';
          const modelYear = v.vehicle?.model_year || v.vehicle?.manufacture_year;
          console.log(`${i+1}. ${v.vehicle.brand_name} ${v.vehicle.model_name} ${modelYear}`);
          console.log(`   Categoria: ${cat} | Placa: ${v.vehicle.plate || 'N/A'}`);
        });
        console.log('');
        
        return activeVehicles;
      }

      return [];
    } catch (error) {
      console.error("❌ Erro ao buscar veículos:", error.message);
      return [];
    }
  }
}

// ==========================================
// CONSULTA PLACA FIPE COM PUPPETEER
// ==========================================

async function consultarPlacaFipePuppeteer(placa) {
  let browser;
  try {
    console.log(`   🔍 Consultando PlacaFipe (Puppeteer)...`);
    
    const placaLimpa = placa.replace(/[-\s]/g, '').toUpperCase();
    const url = `https://placafipe.com/placa/${placaLimpa}`;
    
    // Abrir navegador headless
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Configurar user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navegar para a página
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Aguardar conteúdo carregar
    await page.waitForSelector('table.fipeTablePriceDetail', { timeout: 10000 });
    
    // Extrair dados da página
    const dados = await page.evaluate(() => {
      const result = {
        dadosVeiculo: {},
        modelosFIPE: []
      };
      
      // Extrair dados da tabela de detalhes
      const detailRows = document.querySelectorAll('table.fipeTablePriceDetail tr');
      detailRows.forEach(row => {
        const label = row.querySelector('td:first-child b')?.textContent?.replace(':', '').trim();
        const value = row.querySelector('td:last-child')?.textContent?.trim();
        if (label && value) {
          result.dadosVeiculo[label] = value;
        }
      });
      
      // Extrair valores FIPE (desktop)
      const fipeRows = document.querySelectorAll('table.fipe-desktop tr');
      fipeRows.forEach((row, i) => {
        if (i === 0) return; // Skip header
        
        const codigo = row.querySelector('td:nth-child(1)')?.textContent?.trim();
        const modelo = row.querySelector('td:nth-child(2)')?.textContent?.trim();
        const valor = row.querySelector('td:nth-child(3)')?.textContent?.trim();
        
        if (codigo && modelo && valor) {
          result.modelosFIPE.push({
            codigo_fipe: codigo,
            modelo_fipe: modelo,
            valor_texto: valor
          });
        }
      });
      
      // Se não achou desktop, tentar mobile
      if (result.modelosFIPE.length === 0) {
        let currentModelo = {};
        const mobileRows = document.querySelectorAll('table.fipe-mobile tr');
        
        mobileRows.forEach(row => {
          const text = row.textContent.trim();
          
          if (text.startsWith('FIPE:')) {
            if (currentModelo.codigo_fipe) {
              result.modelosFIPE.push(currentModelo);
            }
            currentModelo = { codigo_fipe: text.replace('FIPE:', '').trim() };
          } else if (text.startsWith('Modelo:')) {
            currentModelo.modelo_fipe = text.replace('Modelo:', '').trim();
          } else if (text.startsWith('Valor:')) {
            currentModelo.valor_texto = text.replace('Valor:', '').trim();
          }
        });
        
        if (currentModelo.codigo_fipe) {
          result.modelosFIPE.push(currentModelo);
        }
      }
      
      return result;
    });
    
    await browser.close();
    
    // Processar valores
    if (dados.modelosFIPE.length > 0) {
      dados.modelosFIPE = dados.modelosFIPE.map(m => ({
        ...m,
        valor_fipe: parseFloat(
          m.valor_texto
            .replace('R$ ', '')
            .replace(/\./g, '')
            .replace(',', '.')
        )
      }));
      
      // Calcular média
      let fipe_price, fipe_code, fipe_model;
      
      if (dados.modelosFIPE.length > 1) {
        const soma = dados.modelosFIPE.reduce((acc, m) => acc + m.valor_fipe, 0);
        fipe_price = soma / dados.modelosFIPE.length;
        fipe_code = dados.modelosFIPE[0].codigo_fipe;
        fipe_model = `${dados.modelosFIPE.length} variações (média)`;
        
        console.log(`   ✅ ${dados.modelosFIPE.length} modelos FIPE encontrados`);
        console.log(`   💰 FIPE Média: R$ ${fipe_price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
      } else {
        fipe_price = dados.modelosFIPE[0].valor_fipe;
        fipe_code = dados.modelosFIPE[0].codigo_fipe;
        fipe_model = dados.modelosFIPE[0].modelo_fipe;
        console.log(`   ✅ FIPE: R$ ${fipe_price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
      }
      
      return {
        fipe_price: fipe_price,
        fipe_code: fipe_code,
        fipe_model: fipe_model,
        fipe_confidence: 'high',
        fipe_month: 'Tabela atual',
        fonte: 'PlacaFipe',
        dados_veiculo: dados.dadosVeiculo,
        modelos_disponiveis: dados.modelosFIPE
      };
    } else {
      console.log(`   ⚠️ Nenhum valor FIPE encontrado`);
      return null;
    }
    
  } catch (error) {
    if (browser) await browser.close();
    console.log(`   ❌ Erro PlacaFipe: ${error.message}`);
    return null;
  }
}

// ==========================================
// CONSULTA FIPE API (FALLBACK)
// ==========================================

async function consultarFipeParallelum(marca, modelo, ano) {
  try {
    console.log(`   📊 Consultando FIPE API...`);
    
    // Mapeamento de marcas problemáticas
    const marcaMap = {
      'volkswagen': 'VW',
      'chevrolet': 'GM',
      'land rover': 'Land Rover',
      'range rover': 'Land Rover',
      'mercedes-benz': 'Mercedes-Benz',
      'mercedes benz': 'Mercedes-Benz'
    };
    
    // Normalizar marca
    const marcaLower = marca.toLowerCase().trim();
    const marcaNormalizada = marcaMap[marcaLower] || marca.trim();
    
    // 1. Buscar código da marca
    const marcasResponse = await axios.get(
      'https://parallelum.com.br/fipe/api/v1/carros/marcas',
      { timeout: 10000 }
    );
    
    // Busca inteligente de marca
    let marcaObj = marcasResponse.data.find(m => {
      const nomeMarca = m.nome.toLowerCase();
      const buscaMarca = marcaNormalizada.toLowerCase();
      
      // Busca exata
      if (nomeMarca === buscaMarca) return true;
      
      // Busca por contém
      if (nomeMarca.includes(buscaMarca) || buscaMarca.includes(nomeMarca)) return true;
      
      // Busca primeira palavra
      const primeiraPalavra = buscaMarca.split(' ')[0];
      if (nomeMarca.includes(primeiraPalavra)) return true;
      
      return false;
    });
    
    if (!marcaObj) {
      console.log(`   ⚠️ Marca não encontrada: ${marca}`);
      return null;
    }
    
    console.log(`   ✓ Marca: ${marcaObj.nome}`);
    
    // 2. Buscar código do modelo
    const modelosResponse = await axios.get(
      `https://parallelum.com.br/fipe/api/v1/carros/marcas/${marcaObj.codigo}/modelos`,
      { timeout: 10000 }
    );
    
    let modeloObj = modelosResponse.data.modelos.find(m => {
      const nomeModelo = m.nome.toLowerCase();
      const buscaModelo = modelo.toLowerCase();
      
      if (nomeModelo.includes(buscaModelo)) return true;
      
      const palavras = buscaModelo.split(' ').filter(p => p.length > 2);
      if (palavras.length >= 2) {
        const matches = palavras.filter(palavra => nomeModelo.includes(palavra));
        return matches.length >= 2;
      }
      
      return false;
    });
    
    if (!modeloObj) {
      const primeirasPalavras = modelo.split(' ').slice(0, 2).join(' ').toLowerCase();
      modeloObj = modelosResponse.data.modelos.find(m => 
        m.nome.toLowerCase().includes(primeirasPalavras)
      );
    }
    
    if (!modeloObj) {
      const primeiraPalavra = modelo.split(' ')[0].toLowerCase();
      modeloObj = modelosResponse.data.modelos.find(m => 
        m.nome.toLowerCase().startsWith(primeiraPalavra)
      );
    }
    
    if (!modeloObj) {
      console.log(`   ⚠️ Modelo não encontrado: ${modelo}`);
      return null;
    }
    
    console.log(`   ✓ Modelo: ${modeloObj.nome}`);
    
    // 3. Buscar código do ano
    const anosResponse = await axios.get(
      `https://parallelum.com.br/fipe/api/v1/carros/marcas/${marcaObj.codigo}/modelos/${modeloObj.codigo}/anos`,
      { timeout: 10000 }
    );
    
    let anoObj = anosResponse.data.find(a => a.nome.includes(ano.toString()));
    
    if (!anoObj && anosResponse.data.length > 0) {
      anoObj = anosResponse.data.find(a => 
        a.nome.includes((ano - 1).toString()) || 
        a.nome.includes((ano + 1).toString())
      );
      
      if (!anoObj) {
        anoObj = anosResponse.data[0];
        console.log(`   ⚠️ Ano ${ano} não encontrado, usando ${anoObj.nome}`);
      }
    }
    
    if (!anoObj) {
      console.log(`   ⚠️ Nenhum ano disponível`);
      return null;
    }
    
    console.log(`   ✓ Ano: ${anoObj.nome}`);
    
    // 4. Consultar FIPE
    const fipeResponse = await axios.get(
      `https://parallelum.com.br/fipe/api/v1/carros/marcas/${marcaObj.codigo}/modelos/${modeloObj.codigo}/anos/${anoObj.codigo}`,
      { timeout: 10000 }
    );
    
    const valor = parseFloat(
      fipeResponse.data.Valor.replace('R$ ', '').replace(/\./g, '').replace(',', '.')
    );
    
    console.log(`   ✅ FIPE: R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
    
    return {
      fipe_price: valor,
      fipe_code: fipeResponse.data.CodigoFipe,
      fipe_confidence: 'high',
      fipe_month: fipeResponse.data.MesReferencia,
      fipe_model: fipeResponse.data.Modelo,
      fonte: 'FIPE API'
    };
    
  } catch (error) {
    console.log(`   ❌ Erro FIPE API: ${error.message}`);
    return null;
  }
}

// ==========================================
// CONSULTA WEBMOTORS
// ==========================================

async function buscarAnunciosWebmotors(marca, modelo, anoMin, anoMax) {
  try {
    console.log(`   🌐 Buscando no Webmotors...`);
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    };
    
    const marcaUrl = marca.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
      
    const modeloUrl = modelo.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    
    const searchUrl = `https://www.webmotors.com.br/comprar/${marcaUrl}/${modeloUrl}?tipoveiculo=carros&anoate=${anoMax}&anode=${anoMin}`;
    
    const response = await axios.get(searchUrl, {
      headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });
    
    const html = response.data;
    const priceMatches = html.match(/R\$\s*([\d.]+,\d{2})/g);
    
    if (priceMatches && priceMatches.length > 3) {
      const prices = priceMatches
        .map(p => parseFloat(p.replace('R$ ', '').replace(/\./g, '').replace(',', '.')))
        .filter(p => p > 1000 && p < 1000000);
      
      if (prices.length >= 3) {
        const avg = prices.reduce((a, b) => a + b) / prices.length;
        
        console.log(`   ✅ ${prices.length} preços encontrados`);
        console.log(`   💰 Média: R$ ${avg.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
        
        return {
          vehicles: prices.map(p => ({ price: p }))
        };
      }
    }
    
    console.log(`   ⚠️ Nenhum preço encontrado`);
    return null;
    
  } catch (error) {
    console.log(`   ⚠️ Webmotors: ${error.message}`);
    return null;
  }
}

// ==========================================
// CLASSE ANALISADORA
// ==========================================

class VehiclePriceAnalyzer {
  
  detectCategory(vehicleItem) {
    const eventName = (vehicleItem.event?.name || '').toLowerCase();
    const categoryName = (vehicleItem.vehicle?.category_name || '').toLowerCase();
    const brandName = (vehicleItem.vehicle?.brand_name || '').toLowerCase();
    const modelName = (vehicleItem.vehicle?.model_name || '').toLowerCase();
    
    // 1. CATEGORIA EXPLÍCITA
    if (categoryName.includes('automovel') || categoryName.includes('automóvel')) {
      return 'Carro';
    }
    
    if (categoryName.includes('utilitario') || categoryName.includes('utilitário')) {
      return 'Carro';
    }
    
    if (categoryName.includes('caminhao') || categoryName.includes('caminhão')) {
      return 'Caminhão';
    }
    
    if (categoryName.includes('motocicleta') || categoryName.includes('moto')) {
      return 'Moto';
    }
    
    if (categoryName.includes('reboque') || categoryName.includes('implemento')) {
      return 'Implemento';
    }
    
    // 2. DETECTAR POR EVENTO
    if (eventName.includes('pesados') || eventName.includes('pesado')) {
      const implementoBrands = ['randon', 'librelato', 'facchini', 'guerra', 'noma'];
      if (implementoBrands.includes(brandName)) {
        return 'Implemento';
      }
      return 'Caminhão';
    }
    
    // 3. CAMINHÕES
    const caminhoesBrands = ['scania', 'volvo', 'mercedes-benz', 'iveco', 'man', 'ford cargo'];
    if (caminhoesBrands.includes(brandName)) {
      if (/(\d{2,4}[-\s]?\d{2,4}|FH|FM|NH|Actros|Atego|Axor)/.test(modelName)) {
        return 'Caminhão';
      }
    }
    
    if (brandName === 'volkswagen') {
      if (/\d{2,4}[-\s]\d{2,4}/.test(modelName)) {
        return 'Caminhão';
      }
    }
    
    // 4. MOTOS
    const motoOnlyBrands = ['honda', 'yamaha', 'suzuki', 'kawasaki', 'harley', 'harley-davidson', 'ducati', 'triumph', 'royal enfield', 'ktm'];
    if (motoOnlyBrands.includes(brandName)) {
      return 'Moto';
    }
    
    // 5. BMW
    if (brandName === 'bmw') {
      const motoModelsBMW = ['g 310', 'f 850', 'r 1250', 's 1000', 'k 1600', 'c 400', 'f 900'];
      if (motoModelsBMW.some(m => modelName.includes(m))) {
        return 'Moto';
      }
      return 'Carro';
    }
    
    // 6. MODELOS DE MOTO
    const motoModels = ['cb 300', 'cb 500', 'cg 160', 'xt 660', 'xre 300', 'mt-03', 'mt-07', 'mt-09', 
                        'r1', 'r6', 'r3', 'ninja 400', 'ninja 650', 'z 400', 'z 900', 'boulevard', 
                        'fazer', 'twister', 'street', 'fat boy', 'softail', 'sportster'];
    
    for (const motoModel of motoModels) {
      if (modelName.includes(motoModel)) {
        return 'Moto';
      }
    }
    
    // 7. EVENTO LEVES
    if (eventName.includes('leves') || eventName.includes('leve')) {
      return 'Carro';
    }
    
    // 8. DEFAULT
    return 'Carro';
  }

  async analisarPrecoCompleto(vehicleItem) {
    const vehicle = vehicleItem.vehicle;
    const negotiation = vehicleItem.negotiation;
    
    const results = {
      fipe: null,
      webmotors: null,
      market_analysis: null,
      recommendation: null
    };
    
    try {
      const category = this.detectCategory(vehicleItem);
      const modelYear = vehicle.model_year || vehicle.manufacture_year;
      const title = `${vehicle.brand_name} ${vehicle.model_name} ${modelYear}`;
      const price = negotiation?.value_actual || 0;
      const placa = vehicle.plate || null;
      
      console.log(`\n${'='.repeat(70)}`);
      console.log(`🚗 ${title}`);
      console.log(`📦 Categoria: ${category}`);
      console.log(`💰 Preço DealersClub: R$ ${price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
      console.log(`📍 ${vehicleItem.shop_stock?.city || 'N/A'}, ${vehicleItem.shop_stock?.state || 'N/A'}`);
      console.log(`📅 Ano Modelo: ${modelYear} | KM: ${vehicle.km?.toLocaleString('pt-BR') || 'N/A'}`);
      console.log(`🏷️ Placa: ${placa || 'N/A'}`);
      console.log('');
      
      // SOMENTE PARA CARROS
      if (category === 'Carro') {
        // PRIORIDADE 1: Consultar pela PLACA (Puppeteer)
        if (placa && placa !== 'N/A') {
          console.log('🔍 Método 1: Consultando pela PLACA (PlacaFipe + Puppeteer)...');
          results.fipe = await consultarPlacaFipePuppeteer(placa);
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // PRIORIDADE 2: Fallback FIPE API
        if (!results.fipe || !results.fipe.fipe_price) {
          console.log('\n🔍 Método 2: Consultando por Marca/Modelo/Ano (FIPE API)...');
          results.fipe = await consultarFipeParallelum(
            vehicle.brand_name,
            vehicle.model_name,
            modelYear
          );
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Webmotors
        console.log('\n🔍 Fase 3: Consultando Webmotors...');
        results.webmotors = await this.consultarWebmotors(
          vehicle.brand_name,
          vehicle.model_name,
          modelYear
        );
        
        // Análise
        console.log('\n📊 Analisando mercado...');
        results.market_analysis = this.analisarMercado(
          price,
          results.fipe?.fipe_price,
          results.webmotors?.webmotors_avg_price
        );
        
        results.recommendation = this.gerarRecomendacao(results);
      } else {
        console.log(`⚠️ Categoria "${category}" - FIPE não aplicável (apenas para carros)`);
        results.recommendation = `ℹ️ Análise de FIPE disponível apenas para carros`;
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Erro na análise:', error.message);
      return results;
    }
  }
  
  async consultarWebmotors(marca, modelo, ano) {
    try {
      const data = await buscarAnunciosWebmotors(marca, modelo, ano - 1, ano + 1);
      
      if (data && data.vehicles?.length > 0) {
        const prices = data.vehicles.map(v => v.price).filter(p => p > 0);
        
        if (prices.length === 0) return null;
        
        const avg = prices.reduce((a, b) => a + b) / prices.length;
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        
        return {
          webmotors_avg_price: avg,
          webmotors_min_price: min,
          webmotors_max_price: max,
          webmotors_listings: prices.length
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  analisarMercado(preco, fipe, webmotors) {
    const analysis = {
      is_good_deal: false,
      discount_from_fipe: null,
      discount_from_market: null,
      price_position: 'unknown',
      economia_fipe: null,
      economia_mercado: null
    };
    
    if (fipe) {
      analysis.discount_from_fipe = ((fipe - preco) / fipe * 100).toFixed(1);
      analysis.economia_fipe = (fipe - preco).toFixed(2);
      
      if (preco < fipe * 0.85) {
        analysis.is_good_deal = true;
        analysis.price_position = 'excellent';
      } else if (preco < fipe * 0.95) {
        analysis.is_good_deal = true;
        analysis.price_position = 'good';
      } else if (preco > fipe * 1.1) {
        analysis.price_position = 'expensive';
      } else {
        analysis.price_position = 'fair';
      }
    }
    
    if (webmotors) {
      analysis.discount_from_market = ((webmotors - preco) / webmotors * 100).toFixed(1);
      analysis.economia_mercado = (webmotors - preco).toFixed(2);
    }
    
    return analysis;
  }
  
  gerarRecomendacao(results) {
    const { fipe, market_analysis } = results;
    
    if (!fipe) {
      return '⚠️ FIPE não disponível';
    }
    
    if (market_analysis.price_position === 'excellent') {
      const economia = parseFloat(market_analysis.economia_fipe).toLocaleString('pt-BR', {minimumFractionDigits: 2});
      return `🎯 EXCELENTE! ${market_analysis.discount_from_fipe}% abaixo da FIPE (economize R$ ${economia})`;
    }
    
    if (market_analysis.price_position === 'good') {
      const economia = parseFloat(market_analysis.economia_fipe).toLocaleString('pt-BR', {minimumFractionDigits: 2});
      return `✅ BOM NEGÓCIO! ${market_analysis.discount_from_fipe}% abaixo da FIPE (economize R$ ${economia})`;
    }
    
    if (market_analysis.price_position === 'expensive') {
      return `⚠️ PREÇO ALTO - ${Math.abs(market_analysis.discount_from_fipe)}% acima da FIPE`;
    }
    
    return `💡 Preço justo - compatível com a FIPE`;
  }
  
exibirResultado(results) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log('📊 RESULTADO DA ANÁLISE');
  console.log('─'.repeat(70));
  
  if (results.fipe) {
    console.log(`\n💰 TABELA FIPE:`);
    console.log(`   Valor: R$ ${results.fipe.fipe_price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
    console.log(`   Modelo: ${results.fipe.fipe_model}`);
    console.log(`   Código: ${results.fipe.fipe_code}`);
    console.log(`   Fonte: ${results.fipe.fonte}`);
  } else {
    console.log(`\n💰 TABELA FIPE: ❌ Não disponível`);
  }
  
  if (results.webmotors) {
    console.log(`\n🌐 MERCADO (WEBMOTORS):`);
    console.log(`   Preço Médio: R$ ${results.webmotors.webmotors_avg_price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`);
    console.log(`   Base: ${results.webmotors.webmotors_listings} anúncios`);
  } else {
    console.log(`\n🌐 MERCADO (WEBMOTORS): ⚠️ Não disponível`);
  }
  
  if (results.market_analysis && results.market_analysis.price_position !== 'unknown') {
    console.log(`\n📈 ANÁLISE DE MERCADO:`);
    console.log(`   Classificação: ${this.traduzirPosicao(results.market_analysis.price_position)}`);
    
    if (results.market_analysis.discount_from_fipe) {
      const sinal = parseFloat(results.market_analysis.discount_from_fipe) >= 0 ? '↓' : '↑';
      console.log(`   ${sinal} Diferença FIPE: ${Math.abs(results.market_analysis.discount_from_fipe)}%`);
    }
    
    if (results.market_analysis.discount_from_market) {
      const sinal = parseFloat(results.market_analysis.discount_from_market) >= 0 ? '↓' : '↑';
      console.log(`   ${sinal} Diferença Mercado: ${Math.abs(results.market_analysis.discount_from_market)}%`);
    }
  }
  
  console.log(`\n🎯 RECOMENDAÇÃO:`);
  console.log(`   ${results.recommendation}`);
  console.log('═'.repeat(70));
}
traduzirPosicao(position) {
const map = {
'excellent': '🌟 EXCELENTE (Muito abaixo do mercado)',
'good': '✅ BOM (Abaixo do mercado)',
'fair': '💡 JUSTO (Preço de mercado)',
'expensive': '⚠️ CARO (Acima do mercado)',
'unknown': '❓ Indeterminado'
};
return map[position] || position;
}
}
// ==========================================
// FUNÇÃO PRINCIPAL DE TESTE
// ==========================================
async function testar() {
console.log('\n🧪 TESTE V4 - ANÁLISE COM PUPPETEER + FIPE API + WEBMOTORS\n');
console.log('═'.repeat(70));
// 1. Login
const dealersAPI = new DealersClubAPI();
const loginSuccess = await dealersAPI.login();
if (!loginSuccess) {
console.error('❌ Falha no login');
process.exit(1);
}
// 2. Buscar veículos
  const qtd = parseInt(process.argv[2]) || 5;
  console.log(`🎯 Buscando ${qtd} veículos...\n`);
  
  const vehicles = await dealersAPI.getVehiclesList(qtd);
  
  if (vehicles.length === 0) {
    console.log('❌ Nenhum veículo encontrado');
    process.exit(1);
  }
  
  // 3. Analisar cada veículo
  const analyzer = new VehiclePriceAnalyzer();
  const resultados = [];
  
  for (let i = 0; i < vehicles.length; i++) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📍 VEÍCULO ${i + 1} DE ${vehicles.length}`);
    console.log('═'.repeat(70));
    
    try {
      const resultado = await analyzer.analisarPrecoCompleto(vehicles[i]);
      analyzer.exibirResultado(resultado);
      
      resultados.push({
        vehicle: vehicles[i],
        analysis: resultado
      });
      
      if (i < vehicles.length - 1) {
        console.log(`\n⏳ Aguardando 3 segundos...\n`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(`\n❌ Erro:`, error.message);
    }
  }
  
  // 4. Resumo final
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('📊 RESUMO GERAL DA ANÁLISE');
  console.log('═'.repeat(70));
  
  const total = resultados.length;
  const comFipe = resultados.filter(r => r.analysis.fipe !== null).length;
  const porPlaca = resultados.filter(r => r.analysis.fipe?.fonte === 'PlacaFipe').length;
  const porAPI = resultados.filter(r => r.analysis.fipe?.fonte === 'FIPE API').length;
  const comWebmotors = resultados.filter(r => r.analysis.webmotors !== null).length;
  const excelentes = resultados.filter(r => r.analysis.market_analysis?.price_position === 'excellent').length;
  const bons = resultados.filter(r => r.analysis.market_analysis?.price_position === 'good').length;
  const caros = resultados.filter(r => r.analysis.market_analysis?.price_position === 'expensive').length;
  const justos = resultados.filter(r => r.analysis.market_analysis?.price_position === 'fair').length;
  
  console.log(`\n📈 ESTATÍSTICAS:`);
  console.log(`   Veículos analisados: ${total}`);
  console.log(`   Com dados FIPE: ${comFipe} (${(comFipe/total*100).toFixed(0)}%)`);
  console.log(`   └─ Via PlacaFipe: ${porPlaca}`);
  console.log(`   └─ Via FIPE API: ${porAPI}`);
  console.log(`   Com dados Webmotors: ${comWebmotors} (${(comWebmotors/total*100).toFixed(0)}%)`);
  
  console.log(`\n🎯 CLASSIFICAÇÃO:`);
  console.log(`   🌟 Oportunidades EXCELENTES: ${excelentes}`);
  console.log(`   ✅ Negócios BONS: ${bons}`);
  console.log(`   💡 Preços JUSTOS: ${justos}`);
  console.log(`   ⚠️ Preços CAROS: ${caros}`);
  
  if (excelentes > 0) {
    console.log(`\n💰 MELHORES OPORTUNIDADES:`);
    resultados
      .filter(r => r.analysis.market_analysis?.price_position === 'excellent')
      .forEach((r, i) => {
        const v = r.vehicle.vehicle;
        const modelYear = v.model_year || v.manufacture_year;
        const discount = r.analysis.market_analysis.discount_from_fipe;
        const fonte = r.analysis.fipe?.fonte || 'N/A';
        console.log(`   ${i+1}. ${v.brand_name} ${v.model_name} ${modelYear} - ${discount}% abaixo (${fonte})`);
      });
  }
  
  console.log(`\n✅ TESTE CONCLUÍDO COM SUCESSO!`);
  console.log('═'.repeat(70));
  console.log('');
}

// Executar teste
testar().catch(error => {
  console.error('\n❌ ERRO FATAL:', error.message);
  console.error(error.stack);
  process.exit(1);
});