require('dotenv').config()
const express = require('express')
const cors = require('cors')
const session = require('express-session')
const path = require('path')
const cron = require('node-cron')
const { query } = require('./config/database')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware CORS - CORRIGIDO
app.use(cors({
    origin: function(origin, callback) {
        // Lista de origens permitidas
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5173',
            'https://fmpcatalogo.onrender.com',
            'https://autogiro.onrender.com',
            'https://clubefmp.com',
            'https://www.clubefmp.com'
        ]
        
        // Se não tem origin (requisições do mesmo domínio) ou está na lista, permite
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true)
        } else {
            callback(null, true) // Permite de qualquer forma em desenvolvimento
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie']
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Session - CORRIGIDO
app.use(session({
    secret: process.env.SESSION_SECRET || 'sua_chave_secreta_aqui_mude_isso_em_producao',
    resave: false,
    saveUninitialized: false,
    name: 'sessionId', // Nome customizado do cookie
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true apenas em HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' para cross-origin em produção
        domain: undefined // Funciona com qualquer domínio
    },
    proxy: true // Importante para funcionar atrás de proxy (Render, Heroku, etc)
}))

// Middleware de debug de sessão (remover em produção)
app.use((req, res, next) => {
    console.log('=== SESSION DEBUG ===')
    console.log('Session ID:', req.sessionID)
    console.log('Session:', req.session)
    console.log('User ID:', req.session?.userId)
    console.log('Cookies:', req.headers.cookie)
    console.log('Origin:', req.headers.origin)
    console.log('====================')
    next()
})

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../frontend')))

// Rotas da API
app.use('/api/auth', require('./routes/auth'))
app.use('/api/vehicles', require('./routes/vehicles'))
app.use('/api/proposals', require('./routes/proposals'))
app.use('/api/credits', require('./routes/credits'))
app.use('/api/admin', require('./routes/admin'))

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        service: 'autogiro-api',
        timestamp: new Date().toISOString(),
        session: {
            id: req.sessionID,
            userId: req.session?.userId || null
        }
    })
})

// Rotas do admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin/index.html'))
})

// Rotas do catálogo público
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalog/index.html'))
})

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalog/login.html'))
})

app.get('/propostas', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalog/propostas.html'))
})

app.get('/recarga', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalog/recarga.html'))
})

app.get('/perfil', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalog/perfil.html'))
})

// Fallback para SPA
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, '../frontend/catalog/index.html'))
    } else {
        res.status(404).json({ 
            success: false, 
            error: 'Rota não encontrada' 
        })
    }
})

// Tratamento de erros
app.use((err, req, res, next) => {
    console.error('Erro:', err.stack)
    res.status(500).json({ 
        success: false, 
        error: 'Erro interno do servidor' 
    })
})

// Cron Job 1 - Desativar veículos sem propostas vencedoras (17:00 todo dia)
cron.schedule('0 20 * * *', async () => {
    try {
        console.log(`[${new Date().toISOString()}] Executando desativação automática de veículos...`)

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

        console.log(`${result.rows.length} veículos desativados automaticamente`)
        
        if (result.rows.length > 0) {
            console.log('Veículos desativados:')
            result.rows.forEach(v => {
                console.log(`  - ${v.title} (ID: ${v.external_id})`)
            })
        }
    } catch (error) {
        console.error('Erro na desativação automática:', error.message)
    }
})

// Cron Job 2 - Buscar veículos do DealersClub (20:00 todo dia)
cron.schedule('0 22 * * *', async () => {
    try {
        console.log(`[${new Date().toISOString()}] Iniciando busca de veículos do DealersClub...`)
        
        const { spawn } = require('child_process')
        
        const scraperProcess = spawn('node', [path.join(__dirname, 'scripts/scraper-to-db.js')])
        
        scraperProcess.stdout.on('data', (data) => {
            console.log(data.toString())
        })
        
        scraperProcess.stderr.on('data', (data) => {
            console.error(data.toString())
        })
        
        scraperProcess.on('close', (code) => {
            if (code === 0) {
                console.log('Scraper executado com sucesso')
            } else {
                console.error(`Scraper finalizou com código ${code}`)
            }
        })
        
    } catch (error) {
        console.error('Erro ao executar scraper:', error.message)
    }
})

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`)
    console.log(`API disponível em http://localhost:${PORT}/api`)
    console.log(`Catálogo em http://localhost:${PORT}`)
    console.log(`Login em http://localhost:${PORT}/login`)
    console.log(`Propostas em http://localhost:${PORT}/propostas`)
    console.log(`Recarga em http://localhost:${PORT}/recarga`)
    console.log(`Perfil em http://localhost:${PORT}/perfil`)
    console.log(`Admin em http://localhost:${PORT}/admin`)
    console.log(`Cron job 1: Desativação às 17:00`)
    console.log(`Cron job 2: Scraper às 20:00`)
    console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`)
})
