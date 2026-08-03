const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());

// Permite conexões do frontend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve a pasta de arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rota de criação do PIX na GoatPay
app.post('/api/gerar-pix', async (req, res) => {
    try {
        const { cnpj } = req.body;
        const cnpjLimpo = cnpj ? cnpj.replace(/\D/g, '') : '00000000000000';

        console.log('Gerando PIX GoatPay para CNPJ:', cnpjLimpo);

        // Requisição oficial GoatPay
        const response = await axios.post('https://api.goatpay.com.br/v1/payment-pix/create', {
            amount: 10.00,
            description: `Consulta CNPJ ${cnpjLimpo}`,
            postback_url: 'https://mdbuscas.onrender.com/webhook/goatpay'
        }, {
            headers: {
                'X-API-Key': 'gp_live_cbfa686e8e5d23369160b58d83a08af10b39b59c8d9d02ee',
                'Content-Type': 'application/json'
            }
        });

        console.log('Resposta GoatPay:', response.data);

        // Pega o código Pix Copia e Cola
        const pixCode = response.data?.pix_copy_paste || 
                        response.data?.qr_code || 
                        response.data?.pix_code || 
                        response.data?.point_of_interaction?.transaction_data?.qr_code;

        if (!pixCode) {
            return res.status(400).json({ error: 'GoatPay não retornou o código PIX', detalhes: response.data });
        }

        return res.json({ pix_code: pixCode });

    } catch (error) {
        const errData = error.response?.data || error.message;
        console.error('ERRO GOATPAY:', errData);
        return res.status(500).json({ error: 'Erro na GoatPay', detalhes: errData });
    }
});

// Webhook
app.post('/webhook/goatpay', (req, res) => {
    res.status(200).send('OK');
});

// Rota principal
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
