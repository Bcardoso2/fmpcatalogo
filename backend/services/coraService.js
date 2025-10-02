const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const https = require('https')
const fs = require('fs')
const path = require('path')

class CoraService {
  constructor() {
    // URLs corretas para Integração Direta (mTLS)
    this.authURL = process.env.CORA_ENV === 'production'
      ? 'https://matls-clients.api.cora.com.br/token'
      : 'https://matls-clients.api.cora.com.br/token'
    
    this.baseURL = process.env.CORA_ENV === 'production' 
      ? 'https://matls-clients.api.cora.com.br' 
      : 'https://matls-clients.api.cora.com.br'
    
    this.clientId = process.env.CORA_CLIENT_ID
    
    // Resolver paths relativos
    this.certificatePath = process.env.CORA_CERTIFICATE_PATH 
      ? path.resolve(process.env.CORA_CERTIFICATE_PATH)
      : null
    this.privateKeyPath = process.env.CORA_PRIVATE_KEY_PATH
      ? path.resolve(process.env.CORA_PRIVATE_KEY_PATH)
      : null
    
    this.accessToken = null
    this.tokenExpiry = null
    this.httpsAgent = null
    
    console.log('Cora Auth Mode: mTLS (Certificate)')
    console.log('Auth URL:', this.authURL)
    console.log('Base URL:', this.baseURL)
    console.log('Certificate:', this.certificatePath)
    console.log('Private Key:', this.privateKeyPath)
  }

  createHttpsAgent() {
    if (this.httpsAgent) return this.httpsAgent

    if (!fs.existsSync(this.certificatePath)) {
      throw new Error(`Certificado não encontrado: ${this.certificatePath}`)
    }
    if (!fs.existsSync(this.privateKeyPath)) {
      throw new Error(`Chave privada não encontrada: ${this.privateKeyPath}`)
    }

    const cert = fs.readFileSync(this.certificatePath)
    const key = fs.readFileSync(this.privateKeyPath)

    this.httpsAgent = new https.Agent({
      cert: cert,
      key: key,
      rejectUnauthorized: true
    })

    return this.httpsAgent
  }

  async authenticate() {
    try {
      const httpsAgent = this.createHttpsAgent()

      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId
      })

      console.log('Autenticando com Cora via mTLS...')
      console.log('URL:', this.authURL)
      console.log('Client ID:', this.clientId)

      const response = await axios.post(this.authURL, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: httpsAgent
      })
      
      this.accessToken = response.data.access_token
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000)
      console.log('Autenticado na Cora via mTLS')
      console.log('Token expira em:', response.data.expires_in, 'segundos')
      return true
    } catch (error) {
      console.error('Erro ao autenticar Cora (mTLS):')
      console.error('Status:', error.response?.status)
      console.error('Data:', error.response?.data)
      console.error('Message:', error.message)
      return false
    }
  }

  async ensureAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry || Date.now() >= this.tokenExpiry - 60000) {
      return await this.authenticate()
    }
    return true
  }

  async createPixInvoice(userData, amount, description) {
    try {
      const authSuccess = await this.ensureAuthenticated()
      if (!authSuccess) throw new Error('Falha na autenticação')

      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 1)
      const dueDateStr = dueDate.toISOString().split('T')[0]

      const amountInCents = Math.round(amount * 100)
      if (amountInCents < 500) {
        throw new Error('Valor mínimo é R$ 5,00')
      }

      const invoiceData = {
        code: `AUTOGIRO-${Date.now()}`,
        customer: {
          name: userData.name.substring(0, 60),
          email: userData.email?.substring(0, 60) || undefined,
          document: {
            identity: userData.cpf.replace(/\D/g, ''),
            type: 'CPF'
          }
        },
        services: [
          {
            name: 'Recarga de Créditos Autogiro',
            description: description?.substring(0, 100),
            amount: amountInCents
          }
        ],
        payment_terms: {
          due_date: dueDateStr
        },
        payment_forms: ['PIX']
      }

      console.log('Criando invoice na Cora...')

      // Usar a mesma conexão mTLS para criar a invoice
      const httpsAgent = this.createHttpsAgent()

      const response = await axios.post(
        `${this.baseURL}/v2/invoices/`,
        invoiceData,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Idempotency-Key': uuidv4()
          },
          httpsAgent: httpsAgent
        }
      )

      console.log('QR Code PIX gerado:', response.data.id)

      return {
        success: true,
        invoice_id: response.data.id,
        status: response.data.status,
        qr_code_emv: response.data.pix?.emv,
        qr_code_url: response.data.payment_options?.bank_slip?.url,
        total_amount: response.data.total_amount / 100,
        total_amount_cents: response.data.total_amount,
        due_date: response.data.payment_terms?.due_date,
        created_at: response.data.created_at
      }
    } catch (error) {
      console.error('Erro ao criar QR Code PIX:', error.response?.data || error.message)
      
      if (error.response?.status === 400) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Dados inválidos'
        return { success: false, error: `Requisição inválida: ${errorMsg}` }
      }
      if (error.response?.status === 401) {
        this.accessToken = null
        return { success: false, error: 'Token inválido ou expirado. Tente novamente.' }
      }
      
      return { 
        success: false, 
        error: error.response?.data?.message || error.message || 'Erro ao gerar cobrança PIX' 
      }
    }
  }

  async checkInvoiceStatus(invoiceId) {
    try {
      await this.ensureAuthenticated()
      
      const httpsAgent = this.createHttpsAgent()

      const response = await axios.get(
        `${this.baseURL}/v2/invoices/${invoiceId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent
        }
      )

      return {
        success: true,
        status: response.data.status,
        paid_at: response.data.occurrence_date,
        total_paid: response.data.total_paid / 100,
        total_amount: response.data.total_amount / 100,
        is_paid: response.data.status === 'PAID',
        payments: response.data.payments
      }
    } catch (error) {
      console.error('Erro ao verificar status:', error.response?.data || error.message)
      return { success: false, error: error.message }
    }
  }
}

module.exports = new CoraService()