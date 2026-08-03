const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());

// Permite requisições de outros locais (CORS)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve os arquivos visuais da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota de consulta do CNPJ (BrasilAPI com fallback para ReceitaWS)
app.get('/api/consulta/:cnpj', async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    try {
        // Tenta primeiro a BrasilAPI
        const response = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
        return res.json(response.data);
    } catch (err1) {
        try {
            // Se falhar, tenta a ReceitaWS
            const response2 = await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpj}`);
            return res.json(response2.data);
        } catch (err2) {
            return res.status(400).json({ error: 'Erro ao consultar CNPJ nas bases de dados.' });
        }
    }
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
        res.status(500).json({ error: 'Erro ao gerar Pix na GoatPay' });
    }
});

// Rota do Webhook para receber a confirmação de pagamento
app.post('/webhook/goatpay', (req, res) => {
    const evento = req.body;
    
    if (evento.status === 'paid' || evento.event === 'payment.completed') {
        console.log('Pix pago com sucesso!', evento);
    }

    res.status(200).send('OK');
});

// Redireciona qualquer outra rota para o index.html
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Porta do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
