const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 🔑 CONFIGURAÇÃO DA API GOATPAY
// =========================================================================
const GOATPAY_API_KEY = "gp_live_e7df14ea590e46a58a6b41c42986e29fdbcf500d1644ca5d";
const GOATPAY_ENDPOINT = "https://api.goatpay.com.br/v1/pix";

// Banco de dados em memória para as solicitações do Admin
let pedidosPendentes = [];

// 1. ROTA DE GERAÇÃO DO PIX REAL PELA GOATPAY
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const respostaGoat = await axios.post(GOATPAY_ENDPOINT, {
            amount: 10.00,
            description: "Taxa de Liberacao Consulta - MD BUSCAS"
        }, {
            headers: {
                'Authorization': `Bearer ${GOATPAY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const dadosPix = respostaGoat.data;

        const txid = dadosPix.id || dadosPix.txid || 'goat_' + Math.random().toString(36).substring(2, 10);
        const qrcodeCopiaCola = dadosPix.qrcode || dadosPix.pix_code;
        const qrcodeImagem = dadosPix.qrcode_image || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrcodeCopiaCola)}`;

        res.json({
            sucesso: true,
            txid: txid,
            qrcode: qrcodeCopiaCola,
            qrcode_image: qrcodeImagem
        });

    } catch (error) {
        console.error("ERRO COMPLETO DA GOATPAY:", error.response ? error.response.data : error.message);
        res.status(500).json({ 
            sucesso: false, 
            erro: error.response && error.response.data ? JSON.stringify(error.response.data) : "Erro ao gerar cobrança na Goatpay." 
        });
    }
});
