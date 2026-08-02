const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pedidos = {};

// 1. ROTA PARA GERAR O PIX
app.post('/api/gerar-pix', async (req, res) => {
  const { cnpj } = req.body;

  if (!cnpj) {
    return res.status(400).json({ error: 'CNPJ é obrigatório' });
  }

  try {
    const response = await axios.post('https://public-api-prod.dominipay.com.br/api-public/payments', {
      amount: 5.00,
      description: `Consulta CNPJ: ${cnpj}`,
      metadata: { cnpjBuscado: cnpj }
    }, {
      headers: {
        'Authorization': 'Bearer COLE_SEU_TOKEN_DOMINIPAY_AQUI',
        'Content-Type': 'application/json'
      }
    });

    const transactionId = response.data.id || response.data.transactionId;

    pedidos[transactionId] = {
      cnpj: cnpj,
      status: 'PENDENTE',
      dadosConsulta: null
    };

    res.json({
      transactionId: transactionId,
      qrCode: response.data.qrCode || response.data.qrcode,
      pixCopiaECola: response.data.pixCopiaECola || response.data.copyPaste
    });

  } catch (error) {
    console.error('Erro ao gerar Pix:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Falha ao gerar cobrança Pix' });
  }
});

// 2. ROTA WEBHOOK
app.post('/webhook/dominipay', async (req, res) => {
  const { status, transactionId, id } = req.body;
  const tId = transactionId || id;

  if (status === 'PAID' || status === 'CONFIRMED' || status === 'PAID_OUT') {
    const pedido = pedidos[tId];

    if (pedido) {
      try {
        const cnpjLimpo = pedido.cnpj.replace(/\D/g, '');
        const apiRes = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);

        pedido.status = 'PAGO';
        pedido.dadosConsulta = apiRes.data;
      } catch (err) {
        console.error('Erro na Brasil API:', err.message);
      }
    }
  }

  res.status(200).send('OK');
});

// 3. ROTA DE STATUS
app.get('/api/status-pedido/:id', (req, res) => {
  const pedido = pedidos[req.params.id];

  if (!pedido) {
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }

  res.json({
    status: pedido.status,
    dados: pedido.status === 'PAGO' ? pedido.dadosConsulta : null
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

