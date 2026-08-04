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

        // Log para depuração se precisar ver no terminal do Termux
        console.log("RESPOSTA GOATPAY:", JSON.stringify(response.data));

        // Pega os dados de dentro do objeto data da API da Goatpay se existir, ou da raiz
        const d = response.data.data || response.data;

        // Varre todas as chaves possíveis que a Goatpay usa para o Pix copia e cola e qr code
        const qrcodeText = d.copyPaste || d.pix_copia_e_cola || d.qrcode || d.emv || d.payload || d.copiaECola || "";
        
        let qrcodeImg = d.qrCodeBase64 || d.qr_code_image || d.imagem_qrc || d.encodedImage || "";
        if (qrcodeImg && !qrcodeImg.startsWith('data:image')) {
            qrcodeImg = `data:image/png;base64,${qrcodeImg}`;
        }

        res.json({
            sucesso: true,
            txid: d.id || d.txid || d.uuid,
            qrcode: qrcodeText,
            qrcode_image: qrcodeImg
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
        
        const d = response.data.data || response.data;
        const status = d.status;
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
