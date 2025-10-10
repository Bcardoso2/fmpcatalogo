// test-login.js
require('dotenv').config()
const axios = require('axios')

async function testLogin() {
  try {
    console.log('Email:', process.env.DEALERS_EMAIL)
    console.log('Password:', process.env.DEALERS_PASSWORD ? '***' : 'NÃO DEFINIDA')
    
    const response = await axios.post(
      'https://prod-backend.dealersclub.com.br/api/v1/login',
      {
        email: process.env.DEALERS_EMAIL,
        password: process.env.DEALERS_PASSWORD,
        whitelabel_origin_id: 8
      },
      {
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'Referer': 'https://vendadireta.dealersclub.com.br/'
        }
      }
    )
    
    console.log('Login OK:', response.data)
  } catch (error) {
    console.error('Erro:', error.response?.data || error.message)
  }
}

testLogin()