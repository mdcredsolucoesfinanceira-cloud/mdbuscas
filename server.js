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
        const txid = data.txid || data.referenceId || data.id || externalRef;

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
        res.status(500).json({ sucesso: false, erro: "Erro na API da goatpay" });
    }
});

// Listar pedidos pendentes no painel admin
app.get('/api/admin/pedidos', (req, res) => {
    if (!db) return res.json([]);
    const result = db.exec(`SELECT * FROM pedidos WHERE status = 'pendente'`);
    if (result.length === 0) return res.json([]);
    let rows = [];
    let cols = result[0].columns;
    result[0].values.forEach(row => {
        let obj = {};
        cols.forEach((col, idx) => { obj[col] = row[idx]; });
        rows.push(obj);
    });
    res.json(rows);
});

// Rota para o Admin aprovar manualmente com um clique
app.get('/api/admin/aprovar/:txid', (req, res) => {
    const txid = req.params.txid;
    if (db) {
        db.run("UPDATE pedidos SET status = 'aprovado' WHERE txid = ? OR alvo = ?", [txid, txid]);
        salvarBanco();
        console.log(`MANUAL: Pedido ${txid} aprovado pelo Admin.`);
    }
    res.json({ sucesso: true });
});

// Checagem de status na tela do cliente
app.get('/api/pagamento/status/:txid', (req, res) => {
    const txid = req.params.txid;
    let status = 'pendente';
    if (db) {
        let stmt = db.prepare("SELECT status FROM pedidos WHERE txid = ? OR alvo = ?");
        stmt.bind([txid, txid]);
        if (stmt.step()) status = stmt.get()[0];
        stmt.free();
    }
    const isAprovado = String(status).toLowerCase().trim() === 'aprovado';
    res.json({ pago: isAprovado, liberadoAdmin: isAprovado });
});

iniciarBanco().then(() => {
    app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
});
