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

// Rota exata que o seu frontend chama no botão
app.post('/api/consulta/solicitar', async (req, res) => {
    try {
        const cnpjLimpo = req.body.cnpj ? req.body.cnpj.replace(/\D/g, '') : '';

        if (!cnpjLimpo || cnpjLimpo.length < 14) {
            return res.status(400).json({ error: 'CNPJ inválido' });
        }

        let nomeEmpresa = 'Empresa Localizada';

        // Tenta buscar o nome da empresa na BrasilAPI ou ReceitaWS
        try {
            const resp = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
            nomeEmpresa = resp.data.razao_social || resp.data.nome_fantasia || nomeEmpresa;
        } catch (e) {
            try {
                const resp2 = await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
                nomeEmpresa = resp2.data.nome || resp2.data.fantasia || nomeEmpresa;
            } catch (err) {
                console.log('Falha ao consultar APIs externas, usando nome padrao.');
            }
        }

        // Tenta gerar cobrança dinamica na GoatPay (se falhar, não quebra a tela)
        let pixInfo = {};
        try {
            const respGoat = await axios.post('https://api.goatpay.com.br/v1/payment-pix/create', {
                amount: 10.00,
                description: `Consulta CNPJ - ${cnpjLimpo}`,
                postback_url: 'https://mdbuscas.onrender.com/webhook/goatpay'
            }, {
                headers: {
                    'X-API-Key': 'gp_live_3687750306c17cf64e48',
                    'Content-Type': 'application/json'
                }
            });
            pixInfo = respGoat.data || {};
        } catch (eGoat) {
            console.log('Erro GoatPay, prosseguindo com resposta padrao.');
        }

        // Retorna a estrutura perfeita para o seu index.html
        res.json({
            nome: nomeEmpresa,
            razao_social: nomeEmpresa,
            empresa: nomeEmpresa,
            pix: pixInfo.qr_code || pixInfo.pix_copy_paste || 'mdbuscas@gmail.com',
            ...pixInfo
        });

    } catch (error) {
        console.error('Erro geral:', error);
        res.status(500).json({ error: 'Erro interno ao consultar CNPJ' });
    }
});

// Webhook da GoatPay
app.post('/webhook/goatpay', (req, res) => {
    res.status(200).send('OK');
});

// Rota coringa para carregar o index.html
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
