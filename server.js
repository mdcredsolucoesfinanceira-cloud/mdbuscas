const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 🔑 CONFIGURAÇÃO OFICIAL GOATPAY
// =========================================================================
const GOATPAY_API_KEY = "gp_live_e7df14ea590e46a58a6b41c42986e29fdbcf500d1644ca5d";
const GOATPAY_ENDPOINT = "https://api.goatpay.com.br/v1/payment-pix/create";
const GOATPAY_WEBHOOK_SECRET = "whsec_b25572932bdc11ebd1212172ff1a6ae5c48d1c4e2c1d1f40";

// Banco de dados em memória para as solicitações do Admin
let pedidosPendentes = [];

// 1. ROTA DE GERAÇÃO DO PIX REAL PELA GOATPAY
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const externalRef = 'pedido_' + Math.random().toString(36).substring(2, 12);

        const respostaGoat = await axios.post(GOATPAY_ENDPOINT, {
            amount: 10.00,
            description: "Taxa de Liberacao Consulta - MD BUSCAS",
            coverFee: false,
            externalReference: externalRef
        }, {
            headers: {
                'X-API-Key': GOATPAY_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const respostaApi = respostaGoat.data;
        const dadosPix = respostaApi.data || respostaApi;

        const txid = dadosPix.id || dadosPix.txid || externalRef;
        const qrcodeCopiaCola = dadosPix.copyPaste || dadosPix.qrcode || dadosPix.pix_code;
        const qrcodeImagem = dadosPix.qrcodeUrl || dadosPix.qrCodeBase64 || dadosPix.qrcode_image || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrcodeCopiaCola)}`;

        res.json({
            sucesso: true,
            txid: txid,
            qrcode: qrcodeCopiaCola,
            qrcode_image: qrcodeImagem
        });

    } catch (error) {
        console.error("ERRO GOATPAY:", error.response ? error.response.data : error.message);
        res.status(500).json({ 
            sucesso: false, 
            erro: "Erro ao gerar Pix na Goatpay." 
        });
    }
});

// 2. ROTA NOTIFICAR WHATSAPP (Aparece no admin.html)
app.post('/api/notificar-whatsapp', (req, res) => {
    const { txid, modulo, alvo } = req.body;
    
    const existe = pedidosPendentes.find(p => p.txid === txid);
    if (!existe && txid) {
        pedidosPendentes.push({
            txid: txid,
            modulo: modulo || 'CONSULTA',
            alvo: alvo || 'Não informado',
            status: 'pendente',
            data: new Date().toLocaleTimeString()
        });
    }
    res.json({ sucesso: true });
});

// 3. ROTA PAINEL ADMIN - LISTAR PEDIDOS
app.get('/api/admin/pedidos', (req, res) => {
    res.json(pedidosPendentes);
});

// 4. ROTA PAINEL ADMIN - LIBERAR CLIENTE
app.post('/api/admin/liberar', (req, res) => {
    const { txid } = req.body;
    const pedido = pedidosPendentes.find(p => p.txid === txid);
    if (pedido) {
        pedido.status = 'aprovado';
        res.json({ sucesso: true });
    } else {
        res.json({ sucesso: false, erro: "Pedido não encontrado" });
    }
});

// 5. CHECAR SE O ADMIN APROVOU
app.get('/api/pagamento/status/:txid', (req, res) => {
    const { txid } = req.params;
    const pedido = pedidosPendentes.find(p => p.txid === txid);
    if (pedido && pedido.status === 'aprovado') {
        res.json({ pago: true, liberadoAdmin: true });
    } else {
        res.json({ pago: false, liberadoAdmin: false });
    }
});

// 6. ROTAS DAS CONSULTAS (CNPJ / CEP)
app.get('/api/consulta/cnpj/:cnpj', async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    try {
        const response = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
        res.json({ sucesso: true, dados: response.data });
    } catch (e) {
        res.json({ sucesso: false, erro: "CNPJ não encontrado ou inválido." });
    }
});

app.get('/api/consulta/cep/:cep', async (req, res) => {
    const cep = req.params.cep.replace(/\D/g, '');
    try {
        const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
        res.json({ sucesso: true, dados: response.data });
    } catch (e) {
        res.json({ sucesso: false, erro: "CEP não encontrado ou inválido." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor MD BUSCAS ativo na porta ${PORT}`);
});
