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

// Inicializa o banco SQLite
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

// 1. ROTA DE GERAÇÃO DO PIX (COM O CAMPO copyPaste CORRIGIDO)
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

    const respData = respostaGoat.data;
    const dados = respData.data || respData;
    
    // Captura exata do campo copyPaste que vem da GoatPay
    const qrcodeCopiaCola = dados.copyPaste || dados.qrCodeCopyPaste || dados.pixCode || dados.qrCode || dados.pix_code;
    const txid = dados.txid || dados.id || externalRef;

    if (!qrcodeCopiaCola) {
      console.error("ERRO: Nao achou o campo copyPaste no JSON:", JSON.stringify(respData));
      return res.status(500).json({ sucesso: false, erro: "Erro ao extrair o QR Code." });
    }

    const qrcodeImage = dados.qrCodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrcodeCopiaCola)}`;

    if (db) {
      try {
        db.run(`INSERT INTO pedidos (txid, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?)`, 
          [txid, 'CONSULTA', externalRef, 'pendente', new Date().toLocaleString()]);
        salvarBanco();
      } catch (e) {}
    }

    res.json({
      sucesso: true,
      txid: txid,
      qrcode: qrcodeCopiaCola,
      qrcode_image: qrcodeImage
    });

  } catch (error) {
    console.error("ERRO GOATPAY AO GERAR:", error.response ? error.response.data : error.message);
    res.status(500).json({ sucesso: false, erro: "Erro ao gerar Pix na Goatpay." });
  }
});

// 2. ROTA NOTIFICAR WHATSAPP / SALVAR PEDIDO
app.post('/api/notificar-whatsapp', async (req, res) => {
  const { txid, modulo, alvo } = req.body;
  if (!txid) return res.status(400).json({ sucesso: false, erro: "Txid ausente" });
  if (db) {
    try {
      const stmt = db.prepare(`SELECT * FROM pedidos WHERE txid = ?`);
      stmt.bind([txid]);
      let existente = stmt.step();
      stmt.free();
      if (!existente) {
        db.run(`INSERT INTO pedidos (txid, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?)`, 
          [txid, modulo || 'CONSULTA', alvo || 'Não informado', 'pendente', new Date().toLocaleString()]);
        salvarBanco();
      }
    } catch (e) {}
  }
  res.json({ sucesso: true });
});

// 3. WEBHOOK DA GOATPAY
app.post('/api/webhook/goatpay', async (req, res) => {
  const payload = req.body;
  const status = payload.status || (payload.data ? payload.data.status : null);
  const txid = payload.externalReference || (payload.data ? payload.data.externalReference : null) || payload.txid;

  if (status && ['PAID', 'APPROVED', 'aprovado', 'paid', 'approved', 'COMPLETED', 'completed'].includes(status.toLowerCase())) {
    if (txid && db) {
      try {
        db.run(`UPDATE pedidos SET status = 'aprovado' WHERE txid = ?`, [txid]);
        salvarBanco();
      } catch (e) {}
    }
  }
  res.status(200).send('OK');
});

// 4. LISTAR PEDIDOS ADMIN
app.get('/api/admin/pedidos', async (req, res) => {
  if (!db) return res.json([]);
  try {
    const result = db.exec(`SELECT * FROM pedidos`);
    if (result.length > 0) {
      const columns = result[0].columns;
      const pedidos = result[0].values.map(row => {
        let obj = {};
        columns.forEach((col, index) => obj[col] = row[index]);
        return obj;
      });
      return res.json(pedidos);
    }
  } catch (e) {}
  res.json([]);
});

// 5. LIBERAR ADMIN
app.post('/api/admin/liberar', async (req, res) => {
  const { txid } = req.body;
  if (db) {
    try {
      db.run(`UPDATE pedidos SET status = 'aprovado' WHERE txid = ?`, [txid]);
      salvarBanco();
    } catch (e) {}
  }
  res.json({ sucesso: true });
});

// 6. CHECAR STATUS DO PAGAMENTO
app.get('/api/pagamento/status/:txid', async (req, res) => {
  const { txid } = req.params;
  let statusPedido = 'pendente';
  if (db) {
    try {
      const stmt = db.prepare(`SELECT status FROM pedidos WHERE txid = ?`);
      stmt.bind([txid]);
      if (stmt.step()) {
        const row = stmt.get();
        statusPedido = row[0];
      }
      stmt.free();
    } catch (e) {}
  }
  res.json({ pago: statusPedido === 'aprovado', liberadoAdmin: statusPedido === 'aprovado' });
});

// 7. CONSULTA CNPJ
app.get('/api/consulta/cnpj/:cnpj', async (req, res) => {
  const cnpj = req.params.cnpj.replace(/\D/g, '');
  let dadosUnificados = {};
  let sucessoBusca = false;
  try {
    const respBrasil = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 5000 });
    if (respBrasil.data) { dadosUnificados = { ...respBrasil.data }; sucessoBusca = true; }
  } catch (e) {}
  try {
    const respReceita = await axios.get(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`);
    if (respReceita.data && respReceita.data.status === 'OK') { dadosUnificados = { ...dadosUnificados, ...respReceita.data }; sucessoBusca = true; }
  } catch (e) {}
  if (sucessoBusca && Object.keys(dadosUnificados).length > 0) res.json({ sucesso: true, dados: dadosUnificados });
  else res.json({ sucesso: false, erro: "CNPJ não encontrado." });
});

// 8. CONSULTA CEP
app.get('/api/consulta/cep/:cep', async (req, res) => {
  const cep = req.params.cep.replace(/\D/g, '');
  try {
    const response = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    res.json({ sucesso: true, dados: response.data });
  } catch (error) {
    res.json({ sucesso: false, erro: "CEP não encontrado." });
  }
});

iniciarBanco().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
});
