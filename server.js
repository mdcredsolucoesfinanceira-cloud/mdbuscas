const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const pedidos = {};

// CONSULTA DUPLA COMPLETA: RECEITA WS + BRASIL API
app.post('/api/consulta/solicitar', async (req, res) => {
    const { cnpj } = req.body;
    if (!cnpj) return res.status(400).json({ error: 'CNPJ e obrigatorio.' });

    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (cleanCnpj.length !== 14) return res.status(400).json({ error: 'CNPJ invalido.' });

    try {
        const [resBrasilAPI, resReceitaWS] = await Promise.allSettled([
            axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`),
            axios.get(`https://receitaws.com.br/v1/cnpj/${cleanCnpj}`)
        ]);

        const dadosBrasil = resBrasilAPI.status === 'fulfilled' ? resBrasilAPI.value.data : null;
        const dadosWS = resReceitaWS.status === 'fulfilled' && resReceitaWS.value.data.status !== 'ERROR' ? resReceitaWS.value.data : null;

        if (!dadosBrasil && !dadosWS) {
            return res.status(400).json({ error: 'CNPJ nao encontrado em nenhuma das bases.' });
        }

        const idPedido = 'REQ-' + Math.floor(100000 + Math.random() * 900000);
        const razaoNome = (dadosBrasil && dadosBrasil.razao_social) || (dadosWS && dadosWS.nome) || 'Empresa Consultada';

        pedidos[idPedido] = {
            idPedido,
            cnpj: cleanCnpj,
            razao: razaoNome,
            status: 'pendente',
            dadosBrasil: dadosBrasil || { erro: 'Dados indisponiveis na Brasil API' },
            dadosWS: dadosWS || { erro: 'Dados indisponiveis na Receita WS' },
            dataHora: new Date().toLocaleTimeString('pt-BR')
        };

        res.json({ idPedido, razao: pedidos[idPedido].razao });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao processar as consultas.' });
    }
});

app.get('/api/consulta/status/:id', (req, res) => {
    const pedido = pedidos[req.params.id];
    if (!pedido) return res.status(404).json({ error: 'Pedido nao encontrado.' });
    
    if (pedido.status === 'aprovado') {
        res.json({ status: 'aprovado', dadosBrasil: pedido.dadosBrasil, dadosWS: pedido.dadosWS });
    } else {
        res.json({ status: 'pendente' });
    }
});

app.get('/api/admin/pedidos', (req, res) => {
    res.json(Object.values(pedidos).reverse());
});

app.post('/api/admin/aprovar', (req, res) => {
    const { idPedido } = req.body;
    if (pedidos[idPedido]) {
        pedidos[idPedido].status = 'aprovado';
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Pedido nao encontrado.' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('--- SERVIDOR ATUALIZADO (ANONYMOUS + DADOS DUPLOS) ---');
});
