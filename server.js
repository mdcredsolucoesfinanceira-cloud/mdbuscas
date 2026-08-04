const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Banco de dados em memória para gerenciar os pedidos do admin
let pedidosPendentes = [];

// 1. Rota para gerar o Pix na Goatpay (ou mock se não configurado)
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const txid = 'txid_' + Math.random().toString(36).substring(2, 12);
        
        // Dados simulados ou integração real com Goatpay
        res.json({
            sucesso: true,
            txid: txid,
            qrcode: "00020126850014br.gov.bcb.pix2563pix.onlyup.com.br/qr/v3/" + txid,
            qrcode_image: "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=PixTest"
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: "Erro ao gerar Pix" });
    }
});

// 2. Rota chamada quando o cliente clica no botão do WhatsApp (Salva no Admin)
app.post('/api/notificar-whatsapp', (req, res) => {
    const { txid, modulo, alvo } = req.body;
    
    // Evita duplicatas do mesmo txid
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

// 3. Rota para o Painel Admin listar os pedidos pendentes
app.get('/api/admin/pedidos', (req, res) => {
    res.json(pedidosPendentes);
});

// 4. Rota para o Admin aprovar/liberar a consulta
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

// 5. Rota para o cliente checar se o Admin já liberou
app.get('/api/pagamento/status/:txid', (req, res) => {
    const { txid } = req.params;
    const pedido = pedidosPendentes.find(p => p.txid === txid);
    if (pedido && pedido.status === 'aprovado') {
        res.json({ pago: true, liberadoAdmin: true });
    } else {
        res.json({ pago: false, liberadoAdmin: false });
    }
});

// 6. Rotas de Consulta (Exemplo CNPJ e CEP)
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
    console.log(`Servidor rodando na porta ${PORT}`);
});
