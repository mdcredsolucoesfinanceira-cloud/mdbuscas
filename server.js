// Rota para gerar Pix via GoatPay
app.post('/api/gerar-pix', async (req, res) => {
    try {
        const response = await axios.post('https://api.goatpay.com.br/v1/payment-pix/create', {
            amount: 5.00, // Valor em Reais (exemplo: R$ 5,00)
            description: 'Consulta CNPJ MDBuscas',
            postback_url: 'https://mdbuscas.onrender.com/webhook/goatpay'
        }, {
            headers: {
                'X-API-Key': 'gp_live_3687750306c17cf64e489c1b6a07c04d226099633e1d3bfc api',
                'Content-Type': 'application/json'
            }
        });

        // Envia a resposta com o QR Code e Copia e Cola para o site
        res.json(response.data);
    } catch (error) {
        console.error('Erro na GoatPay:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao gerar Pix' });
    }
});

// Rota do Webhook para receber a confirmação de pagamento da GoatPay
app.post('/webhook/goatpay', (req, res) => {
    const evento = req.body;
    
    // Verifica se o pagamento foi concluído/pago
    if (evento.status === 'paid' || evento.event === 'payment.completed') {
        console.log('Pix pago com sucesso!', evento);
        // Aqui o seu código libera a consulta de CNPJ para o cliente
    }

    res.status(200).send('OK');
});

