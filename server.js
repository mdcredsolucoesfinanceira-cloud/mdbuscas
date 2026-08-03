const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Permite requisições de outros locais (CORS sem biblioteca externa)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Rota para gerar Pix via GoatPay
app.post('/api/gerar-pix', async (req, res) => {
    try {
        const response = await axios.post('https://api.goatpay.com.br/v1/payment-pix/create', {
            amount: 5.00,
            description: 'Consulta CNPJ MDBuscas',
            postback_url: 'https://mdbuscas.onrender.com/webhook/goatpay'
        }, {
            headers: {
                'X-API-Key': 'gp_live_3687750306c17cf64e48',
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Erro na GoatPay:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao gerar Pix' });
    }
});

// Rota do Webhook para receber a confirmação de pagamento da GoatPay
app.post('/webhook/goatpay', (req, res) => {
    const evento = req.body;
    
    if (evento.status === 'paid' || evento.event === 'payment.completed') {
        console.log('Pix pago com sucesso!', evento);
    }

    res.status(200).send('OK');
});

// Porta do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
