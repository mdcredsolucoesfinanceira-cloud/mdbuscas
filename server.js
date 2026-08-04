const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GOATPAY_TOKEN = "gp_live_81d0c1ea8d727f0f8603e4a1a444c7e2a8ad43ccc9c18a72"; 

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

        console.log("Resposta Goatpay:", JSON.stringify(response.data));

        const r = response.data.data || response.data;

        // Captura todas as variações possíveis que a API da Goatpay pode retornar
        res.json({
            sucesso: true,
            txid: r.id || r.txid || r.uuid,
            qrcode: r.pix_copia_e_cola || r.qrcode || r.emv || r.payload || r.copiaECola,
            qrcode_image: r.qr_code_image || r.imagem_qrc || r.encodedImage || r.qrCodeBase64 || (r.qrCode ? `data:image/png;base64,${r.qrCode}` : '')
        });

    } catch (error) {
        console.error("Erro Goatpay:", error.response?.data || error.message);
        res.status(500).json({ sucesso: false, erro: "Falha ao gerar PIX na Goatpay." });
    }
});

app.get('/api/pagamento/status/:txid', async (req, res) => {
    const { txid } = req.params;
    try {
        const response = await axios.get(`https://api.goatpay.com.br/v1/payment-pix/${txid}`, {
            headers: { 
                'X-API-Key': GOATPAY_TOKEN,
                'Authorization': `Bearer ${GOATPAY_TOKEN}` 
            }
        });
        
        const r = response.data.data || response.data;
        const status = r.status;
        const pago = (status === 'approved' || status === 'PAID' || status === 'pago' || status === 'CONCLUIDA' || status === 'COMPLETED');

        res.json({ pago: pago });
    } catch (error) {
        res.json({ pago: false }); 
    }
});

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
