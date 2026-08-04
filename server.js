const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Memória temporária para simular pagamento de teste
const pagamentosTeste = {};

// 1. ROTA PARA GERAR O PIX DE TESTE (R$ 10,00)
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const txid = "teste_" + Date.now();
        pagamentosTeste[txid] = false;
        
        // Auto-aprova o pagamento após 5 segundos para você testar a liberação das APIs!
        setTimeout(() => { 
            pagamentosTeste[txid] = true; 
            console.log(`[TESTE] Pagamento ${txid} foi APROVADO automaticamente.`);
        }, 5000);

        res.json({
            sucesso: true,
            txid: txid,
            qrcode: "00020101021226740014br.gov.bcb.pix.SIMULACAO_R$10_MD_BUSCAS",
            qrcode_image: "https://upload.wikimedia.org/wikipedia/commons/d/d0/QR_code_for_mobile_English_Wikipedia.svg"
        });

    } catch (error) {
        res.status(500).json({ sucesso: false, erro: "Falha ao gerar PIX de teste." });
    }
});

// 2. ROTA PARA VERIFICAR O STATUS DO PIX DE TESTE
app.get('/api/pagamento/status/:txid', async (req, res) => {
    const { txid } = req.params;
    if (pagamentosTeste[txid] !== undefined) {
        return res.json({ pago: pagamentosTeste[txid] });
    }
    res.json({ pago: false }); 
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
app.listen(PORT, () => console.log(`Servidor de TESTE rodando na porta ${PORT}`));
