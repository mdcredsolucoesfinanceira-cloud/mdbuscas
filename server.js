const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve os arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota solicitada pelo botão de consulta
app.post('/api/consulta/solicitar', async (req, res) => {
    try {
        const cnpjLimpo = req.body.cnpj ? req.body.cnpj.replace(/\D/g, '') : '';

        if (!cnpjLimpo || cnpjLimpo.length < 14) {
            return res.status(400).json({ error: 'CNPJ inválido' });
        }

        let nomeEncontrado = 'Empresa Localizada';

        // 1. Busca nome da Empresa (BrasilAPI / ReceitaWS)
        try {
            const resp = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
            nomeEncontrado = resp.data.razao_social || resp.data.nome_fantasia || nomeEncontrado;
        } catch (e1) {
            try {
                const resp2 = await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
                nomeEncontrado = resp2.data.nome || resp2.data.fantasia || nomeEncontrado;
            } catch (e2) {
                console.log('Não foi possível obter o nome nas APIs externas.');
            }
        }

        // 2. Chama a API da GoatPay para gerar o Pix de R$ 10,00
        let codigoPix = 'mdbuscas@gmail.com';
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

            // Extrai a chave/copia e cola se retornado pela GoatPay
            codigoPix = respGoat.data?.pix_copy_paste || respGoat.data?.qr_code || respGoat.data?.point_of_interaction?.transaction_data?.qr_code || codigoPix;
        } catch (errGoat) {
            console.error('Erro GoatPay:', errGoat.response?.data || errGoat.message);
        }

        // Retorna todos os nomes possíveis para o frontend preencher "empresaNome" sem falhar
        res.json({
            empresaNome: nomeEncontrado,
            nome: nomeEncontrado,
            razao_social: nomeEncontrado,
            razaoSocial: nomeEncontrado,
            empresa: nomeEncontrado,
            pix: codigoPix,
            chavePixTexto: codigoPix
        });

    } catch (error) {
        console.error('Erro na requisição:', error);
        res.status(500).json({ error: 'Erro ao processar consulta' });
    }
});

// Webhook GoatPay
app.post('/webhook/goatpay', (req, res) => {
    res.status(200).send('OK');
});

// Rota coringa para carregar o index.html
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
