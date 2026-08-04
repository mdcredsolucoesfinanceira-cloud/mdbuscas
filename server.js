const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sua Nova Chave Real da Goatpay
const GOATPAY_TOKEN = "gp_live_81d0c1ea8d727f0f8603e4a1a444c7e2a8ad43ccc9c18a72"; 

// ROTA PARA GERAR O PIX NA GOATPAY
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const response = await axios.post('https://api.goatpay.com.br/v1/payment-pix/create', {
            amount: 10.00,
            description: "MD CONSULTORIA E MEIOS DE PAGAMENTO",
            externalReference: "md_" + Date.now()
        }, {
            headers: { 
                'X-API-Key': GOATPAY_TOKEN,
                'Authorization': `Bearer ${GOATPAY_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const respData = response.data.data || response.data;

        res.json({
            sucesso: true,
            txid: respData.id || respData.txid || respData.uuid,
            qrcode: respData.pix_copia_e_cola || respData.qrcode || respData.emv,
            qrcode_image: respData.qr_code_image || respData.imagem_qrc || respData.encodedImage
        });

    } catch (error) {
        console.error("Erro Goatpay:", error.response?.data || error.message);
        res.status(500).json({ sucesso: false, erro: "Falha ao gerar PIX na Goatpay." });
    }
});

// ROTA PARA VERIFICAR STATUS DO PAGAMENTO NA GOATPAY
app.get('/api/pagamento/status/:txid', async (req, res) => {
    const { txid } = req.params;
    try {
        const response = await axios.get(`https://api.goatpay.com.br/v1/payment-pix/${txid}`, {
            headers: { 
                'X-API-Key': GOATPAY_TOKEN,
                'Authorization': `Bearer ${GOATPAY_TOKEN}` 
            }
        });
        
        const respData = response.data.data || response.data;
        const status = respData.status;
        const pago = (status === 'approved' || status === 'PAID' || status === 'pago' || status === 'CONCLUIDA' || status === 'COMPLETED');

        res.json({ pago: pago });
    } catch (error) {
        res.json({ pago: false }); 
    }
});

// ROTA PARA CONSULTAR CNPJ (BrasilAPI + ReceitaWS)
app.get('/api/consulta/cnpj/:cnpj', async (req, res) => {
    let cnpj = req.params.cnpj.replace(/\D/g, '');
    try {
        const [brasilApi, receitaWs] = await Promise.allSettled([
            axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`),
            axios.get(`https://receitaws.com.br/v1/cnpj/${cnpj}`)
        ]);
        res.json({
            sucesso: true,
            dados: {
                Fonte_BrasilAPI: brasilApi.status === 'fulfilled' ? brasilApi.value.data : "Indisponível",
                Fonte_ReceitaWS: receitaWs.status === 'fulfilled' ? receitaWs.value.data : "Indisponível"
            }
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: "Erro na consulta de CNPJ" });
    }
});

// ROTA PARA CONSULTAR CEP (BrasilAPI)
app.get('/api/consulta/cep/:cep', async (req, res) => {
    let cep = req.params.cep.replace(/\D/g, '');
    try {
        const response = await axios.get(`https://brasilapi.com.br/api/cep/v2/${cep}`);
        res.json({ sucesso: true, dados: response.data });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: "Erro na consulta de CEP" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor OFICIAL rodando na porta ${PORT}`));
