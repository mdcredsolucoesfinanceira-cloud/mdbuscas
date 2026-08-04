const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sua Chave Real da Goatpay integrada
const GOATPAY_TOKEN = "gp_live_e793a0b1c720448c8fc3cbc4a0f58baac88e1cf7c0312832"; 

// 1. ROTA PARA GERAR O PIX REAL NA GOATPAY
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const response = await axios.post('https://api.goatpay.com.br/v1/pix', {
            amount: 10.00,
            // Aqui definimos o nome que vai aparecer para o cliente no comprovante/banco
            description: "MD CONSULTORIA E MEIOS DE PAGAMENTO"
        }, {
            headers: { 
                'Authorization': `Bearer ${GOATPAY_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({
            sucesso: true,
            txid: response.data.id || response.data.txid,
            qrcode: response.data.pix_copia_e_cola || response.data.qrcode,
            qrcode_image: response.data.qr_code_image || response.data.imagem_qrc
        });

    } catch (error) {
        console.error("Erro Goatpay:", error.response?.data || error.message);
        res.status(500).json({ sucesso: false, erro: "Falha ao gerar PIX na Goatpay." });
    }
});

// 2. ROTA PARA VERIFICAR O STATUS DO PAGAMENTO NA GOATPAY
app.get('/api/pagamento/status/:txid', async (req, res) => {
    const { txid } = req.params;
    try {
        const response = await axios.get(`https://api.goatpay.com.br/v1/pix/${txid}`, {
            headers: { 'Authorization': `Bearer ${GOATPAY_TOKEN}` }
        });
        
        const status = response.data.status;
        // Aceita os status comuns de aprovação da Goatpay
        const pago = (status === 'approved' || status === 'PAID' || status === 'pago' || status === 'CONCLUIDA');

        res.json({ pago: pago });
    } catch (error) {
        // Se der algum erro na consulta temporária, retorna falso para continuar tentando
        res.json({ pago: false }); 
    }
});

// 3. ROTA PARA CONSULTAR CNPJ (BrasilAPI + ReceitaWS)
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

// 4. ROTA PARA CONSULTAR CEP (BrasilAPI)
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
