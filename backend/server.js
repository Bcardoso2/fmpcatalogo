require('dotenv').config()
const express = require('express')
const cors = require('cors')
const session = require('express-session')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? 'https://seu-dominio.com' 
        : 'http://localhost:3000',
    credentials: true
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'sua_chave_secreta_aqui',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}))

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../frontend')))

// Rotas da API
app.use('/api/auth', require('./routes/auth'))
app.use('/api/vehicles', require('./routes/vehicles'))
app.use('/api/proposals', require('./routes/proposals'))
app.use('/api/credits', require('./routes/credits'))
app.use('/api/admin', require('./routes/admin'))

// =======================================================
// ✅ ROTA DE HEALTH CHECK NA RAIZ (MELHOR PARA CRONJOB)
// =======================================================
app.get('/health', (req, res) => {
    // Rota simples e leve, sem consultar o banco de dados.
    res.status(200).json({ 
        status: 'ok', 
        service: 'autogiro-api',
        timestamp: new Date().toISOString()
    });
})

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin/index.html'))
})


// Rota de fallback para o catálogo (mantida)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalog/index.html'))
})

// Tratamento de erros
app.use((err, req, res, next) => {
    console.error('Erro:', err.stack)
    res.status(500).json({ 
        success: false, 
        error: 'Erro interno do servidor' 
    })
})

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
    console.log(`📊 API disponível em http://localhost:${PORT}/api`)
    console.log(`🎨 Catálogo em http://localhost:${PORT}`)
})
