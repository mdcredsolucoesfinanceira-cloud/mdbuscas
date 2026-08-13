const express = require('express');
const path = require('path');
const axios = require('axios');
const initSqlJs = require('sql.js');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GOATPAY_API_KEY = "gp_live_a72b7c6c37ca2cf36be3b5e55997452711d20fc7d5663a7d";
const GOATPAY_ENDPOINT = "https://api.goatpay.com.br/v1/payment-pix/create";

let db = null;

async function iniciarBanco() {
  try {
    const SQL = await initSqlJs();
    const dbFile = './banco.sqlite';
    if (fs.existsSync(dbFile)) {
      db = new SQL.Database(fs.readFileSync(dbFile));
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
    )`);
    salvarBanco();
    console.log("Banco SQLite pronto!");
  } catch (e) {
    console.log("Erro no banco:", e.message);
  }
}

function salvarBanco() {
  if (db) {
    try {
      fs.writeFileSync('./banco.sqlite', Buffer.from(db.export()));
    } catch (e) {}
  }
}

app.post('/api/pagamento/pix', async (req, res) => {
  try {
    const externalRef = 'pedido_' + Math.random().toString(36).substring(2, 12);
    
    const respostaGoat = await axios.post(GOATPAY_ENDPOINT, {
      amount: 10.00,
      description: "Taxa de Liberacao Consulta - MD BUSCAS",
      coverFee: false,
      externalReference: externalRef
    }, {
      headers: { 'X-API-Key': GOATPAY_API_KEY, 'Content-Type': 'application/json' }
    });

    const respData = respostaGoat.data;
    const dados = respData.data || respData;
    const qrcodeCopiaCola = dados.copyPaste || dados.qrCodeCopyPaste || dados.pixCode || dados.qrCode || dados.pix_code;
    const txid = dados.txid || dados.id || externalRef;

    if (!qrcodeCopiaCola) return res.status(500).json({ sucesso: false, erro: "Erro ao extrair o QR Code." });

    if (db) {
      db.run(`INSERT INTO pedidos (txid, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?)`, 
        [txid, 'CONSULTA', externalRef, 'pendente', new Date().toLocaleString()]);
      salvarBanco();
    }

    res.json({ sucesso: true, txid: txid, qrcode: qrcodeCopiaCola, qrcode_image: dados.qrCodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrcodeCopiaCola)}` });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: "Erro ao gerar Pix na Goatpay." });
  }
});

app.post('/api/notificar-whatsapp', async (req, res) => {
  const { txid, modulo, alvo } = req.body;
  if (txid && db) {
    db.run(`INSERT INTO pedidos (txid, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?)`, 
      [txid, modulo || 'CONSULTA', alvo || 'Não informado', 'pendente', new Date().toLocaleString()]);
    salvarBanco();
  }
  res.json({ sucesso: true });
});

app.post('/api/webhook/goatpay', async (req, res) => {
  const payload = req.body;
  const txid = payload.externalReference || (payload.data ? payload.data.externalReference : null) || payload.txid;
  if (txid && db) {
    db.run(`UPDATE pedidos SET status = 'aprovado' WHERE txid = ?`, [txid]);
    salvarBanco();
  }
  res.status(200).send('OK');
});

app.get('/api/admin/pedidos', (req, res) => {
  if (!db) return res.json([]);
  const result = db.exec(`SELECT * FROM pedidos`);
  res.json(result.length > 0 ? result[0].values.map((row, i) => {
    let obj = {};
    result[0].columns.forEach((col, idx) => obj[col] = row[idx]);
    return obj;
  }) : []);
});

app.post('/api/admin/liberar', (req, res) => {
  const { txid } = req.body;
  if (db) { db.run(`UPDATE pedidos SET status = 'aprovado' WHERE txid = ?`, [txid]); salvarBanco(); }
  res.json({ sucesso: true });
});

// ROTA 6 CORRIGIDA E BLINDADA
app.get('/api/pagamento/status/:txid', (req, res) => {
  const { txid } = req.params;
  let statusPedido = 'pendente';
  if (db) {
    const stmt = db.prepare(`SELECT status FROM pedidos WHERE txid = ?`);
    stmt.bind([txid]);
    if (stmt.step()) { statusPedido = String(stmt.get()[0]).toLowerCase().trim(); }
    stmt.free();
  }
  const isAprovado = ['aprovado', 'paid', 'approved', 'completed', 'sucesso'].includes(statusPedido);
  res.json({ pago: isAprovado, liberadoAdmin: isAprovado });
});

app.get('/api/consulta/cnpj/:cnpj', async (req, res) => {
  const cnpj = req.params.cnpj.replace(/\D/g, '');
  try {
    const response = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    res.json({ sucesso: true, dados: response.data });
  } catch (e) { res.json({ sucesso: false, erro: "CNPJ não encontrado." }); }
});

app.get('/api/consulta/cep/:cep', async (req, res) => {
  const cep = req.params.cep.replace(/\D/g, '');
  try {
    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    res.json({ sucesso: true, dados: response.data });
  } catch (error) { res.json({ sucesso: false, erro: "CEP não encontrado." }); }
});

iniciarBanco().then(() => {
  app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
});
