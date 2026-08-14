const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const GOATPAY_API_KEY = "gp_live_38201e0d636cc281aa189a71a4d562d520988bb75e77c8ca";
const GOATPAY_ENDPOINT = "https://api.goatpay.com.br/v1/payment-pix/create";

let db = null;

async function iniciarBanco() {
    try {
        const SQL = await initSqlJs();
        const dbfile = './banco.sqlite';
        if (fs.existsSync(dbfile)) {
            db = new SQL.Database(fs.readFileSync(dbfile));
        } else {
            db = new SQL.Database();
        }
        db.run(`CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT,
            modulo TEXT,
            alvo TEXT,
            status TEXT,
            data TEXT
        );`);
        salvarBanco();
        console.log("Banco SQLite carregado.");
    } catch (e) { console.log("Erro banco:", e); }
}

function salvarBanco() {
    if (db) fs.writeFileSync('./banco.sqlite', Buffer.from(db.export()));
}

// ROTA DO PIX COM A CHAVE NOVA
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const externalRef = 'pedido_' + Math.random().toString(36).substring(2, 12);
        const response = await axios.post(GOATPAY_ENDPOINT, {
            amount: 10.00,
            description: "Consulta MD BUSCAS",
            externalReference: externalRef
        }, {
            headers: { 'X-API-Key': GOATPAY_API_KEY, 'Content-Type': 'application/json' }
        });

        const data = response.data.data || response.data;
        const qrcode = data.copyPaste || data.pixCode || data.qrcode || "";
        const txid = data.txid || externalRef;

        if (db) {
            db.run("INSERT INTO pedidos (txid, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?)",
                [txid, "CONSULTA", externalRef, 'pendente', new Date().toLocaleString()]);
            salvarBanco();
        }

        res.json({ 
            sucesso: true, 
            txid, 
            qrcode: qrcode, 
            qrcode_image: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrcode)}` 
        });
    } catch (e) {
        console.error("Erro na API da Goatpay:", e.response?.data || e.message);
        res.status(500).json({ sucesso: false, erro: "Erro na API da Goatpay" });
    }
});

// WEBHOOK DE CONFIRMAÇÃO AUTOMÁTICA
app.post('/api/webhook/goatpay', (req, res) => {
    const payload = req.body;
    const status = payload.status || payload.data?.status;
    const txid = payload.data?.externalReference || payload.txid;

    if (db && txid && (status === 'PAID' || status === 'approved')) {
        db.run("UPDATE pedidos SET status = 'aprovado' WHERE txid = ?", [txid]);
        salvarBanco();
        console.log(`Pedido ${txid} aprovado via webhook!`);
    }
    res.status(200).send('OK');
});

// STATUS PARA O FRONTEND
app.get('/api/pagamento/status/:txid', (req, res) => {
    let status = 'pendente';
    if (db) {
        let stmt = db.prepare("SELECT status FROM pedidos WHERE txid = ?");
        stmt.bind([req.params.txid]);
        if (stmt.step()) status = stmt.get()[0];
        stmt.free();
    }
    const isAprovado = ['aprovado', 'paid', 'approved', 'completed', 'sucesso'].includes(status);
    res.json({ pago: isAprovado, liberadoAdmin: isAprovado });
});

iniciarBanco().then(() => {
    app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
});
