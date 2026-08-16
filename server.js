const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const initSqlJs = require('sql.js');
const app = express();
const PORT = process.env.PORT || 3000;

const GOATPAY_API_KEY = process.env.GOATPAY_API_KEY;
const GOATPAY_WEBHOOK_SECRET = process.env.GOATPAY_WEBHOOK_SECRET;
const GOATPAY_ENDPOINT = "https://api.goatpay.com.br/v1/payment-pix/create";
const VALOR_CONSULTA = 10.00;

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET || 'mude_essa_chave_no_render';

app.use('/api/webhook/goatpay', express.raw({ type: '*/*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use((req, res, next) => {
    const protegidas = ['/admin.html', '/dashboard.html'];
    if (protegidas.includes(req.path) && !(req.session && req.session.autenticado)) {
        return res.redirect('/login.html');
    }
    next();
});

app.use(express.static('public'));

let db = null;

async function iniciarBanco() {
    try {
        const SQL = await initSqlJs();
        const dbfile = process.env.DB_PATH || './banco.sqlite';
        if (fs.existsSync(dbfile)) {
            db = new SQL.Database(fs.readFileSync(dbfile));
        } else {
            db = new SQL.Database();
        }
        db.run(`CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT,
            goatpay_id TEXT,
            modulo TEXT,
            alvo TEXT,
            status TEXT,
            data TEXT
        );`);
        try {
            db.run(`ALTER TABLE pedidos ADD COLUMN goatpay_id TEXT;`);
        } catch (e) { /* já existe */ }
        salvarBanco();
        console.log("Banco SQLite carregado de:", dbfile);
    } catch (e) { console.log("Erro banco:", e); }
}

function salvarBanco() {
    if (db) fs.writeFileSync(process.env.DB_PATH || './banco.sqlite', Buffer.from(db.export()));
}

function verificarAssinaturaGoatPay(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
    const received = signatureHeader.slice("sha256=".length);
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function statusAprovado(status) {
    return ['aprovado', 'paid', 'approved', 'completed', 'sucesso'].includes(status);
}

function exigirLogin(req, res, next) {
    if (req.session && req.session.autenticado) return next();
    return res.status(401).json({ sucesso: false, erro: "Não autenticado" });
}

// LOGIN
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (!ADMIN_USER || !ADMIN_PASS) {
        return res.status(500).json({ sucesso: false, erro: "Login não configurado no servidor" });
    }
    if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
        req.session.autenticado = true;
        return res.json({ sucesso: true });
    }
    res.status(401).json({ sucesso: false, erro: "Usuário ou senha incorretos" });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ sucesso: true }));
});

// ROTA DO PIX
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const { modulo, alvo } = req.body;
        if (!modulo || !alvo) {
            return res.status(400).json({ sucesso: false, erro: "Módulo e alvo são obrigatórios" });
        }
        const moduloUpper = modulo.toUpperCase();

        if (moduloUpper === 'CNPJ') {
            const cnpjLimpo = alvo.replace(/\D/g, '');
            if (cnpjLimpo.length !== 14) {
                return res.status(400).json({ sucesso: false, erro: "CNPJ inválido. Digite os 14 números." });
            }
            try {
                await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
            } catch (e) {
                return res.status(400).json({ sucesso: false, erro: "CNPJ não encontrado. Confira o número digitado." });
            }
        } else if (moduloUpper === 'CEP') {
            const cepLimpo = alvo.replace(/\D/g, '');
            if (cepLimpo.length !== 8) {
                return res.status(400).json({ sucesso: false, erro: "CEP inválido. Digite os 8 números." });
            }
            try {
                await axios.get(`https://brasilapi.com.br/api/cep/v1/${cepLimpo}`);
            } catch (e) {
                return res.status(400).json({ sucesso: false, erro: "CEP não encontrado. Confira o número digitado." });
            }
        } else {
            return res.status(400).json({ sucesso: false, erro: "Módulo inválido" });
        }

        const externalRef = 'pedido_' + Math.random().toString(36).substring(2, 12);
        const response = await axios.post(GOATPAY_ENDPOINT, {
            amount: VALOR_CONSULTA,
            description: "Consulta MD BUSCAS",
            externalReference: externalRef
        }, {
            headers: { 'X-API-Key': GOATPAY_API_KEY, 'Content-Type': 'application/json' }
        });

        const data = response.data.data || response.data;
        const copyPaste = data.copyPaste || "";
        const goatpayId = data.id || "";
        const qrcodeImage = data.qrCodeImage
            ? data.qrCodeImage
            : `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(copyPaste)}`;

        if (db) {
            db.run("INSERT INTO pedidos (txid, goatpay_id, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?, ?)",
                [externalRef, goatpayId, modulo, alvo, 'pendente', new Date().toLocaleString()]);
            salvarBanco();
        }

        res.json({ sucesso: true, txid: externalRef, qrcode: copyPaste, qrcode_image: qrcodeImage });
    } catch (e) {
        console.error("Erro na API da Goatpay:", e.response?.data || e.message);
        res.status(500).json({ sucesso: false, erro: "Erro na API da Goatpay" });
    }
});

// WEBHOOK
app.post('/api/webhook/goatpay', (req, res) => {
    const signatureHeader = req.headers['x-goatpay-signature'];
    const eventType = req.headers['x-goatpay-event'];
    const rawBody = req.body;

    if (!GOATPAY_WEBHOOK_SECRET) {
        console.error("GOATPAY_WEBHOOK_SECRET não configurado — recusando webhook.");
        return res.status(500).send('Webhook secret não configurado');
    }

    const valido = verificarAssinaturaGoatPay(rawBody, signatureHeader, GOATPAY_WEBHOOK_SECRET);
    if (!valido) {
        console.warn("Webhook com assinatura inválida — recusado. Evento:", eventType);
        return res.status(401).send('Assinatura inválida');
    }

    let payload;
    try {
        payload = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
        return res.status(400).send('JSON inválido');
    }

    console.log("Webhook válido recebido:", eventType, JSON.stringify(payload));

    const evento = payload.event || eventType;
    const eventData = payload.data || {};
    const goatpayId = eventData.id || eventData.referenceId;

    if (db && goatpayId && (evento === 'payment.paid' || eventData.status === 'PAID')) {
        db.run("UPDATE pedidos SET status = 'aprovado' WHERE goatpay_id = ?", [goatpayId]);
        salvarBanco();
        console.log(`Pedido com goatpay_id ${goatpayId} aprovado via webhook!`);
    }

    res.status(200).send('OK');
});

// STATUS
app.get('/api/pagamento/status/:txid', (req, res) => {
    let status = 'pendente';
    if (db) {
        let stmt = db.prepare("SELECT status FROM pedidos WHERE txid = ?");
        stmt.bind([req.params.txid]);
        if (stmt.step()) status = stmt.get()[0];
        stmt.free();
    }
    res.json({ pago: statusAprovado(status), liberadoAdmin: statusAprovado(status) });
});

// CONSULTA
app.get('/api/consulta/:txid', async (req, res) => {
    const { txid } = req.params;
    if (!db) return res.status(500).json({ sucesso: false, erro: "Banco indisponível" });

    let stmt = db.prepare("SELECT modulo, alvo, status FROM pedidos WHERE txid = ?");
    stmt.bind([txid]);
    if (!stmt.step()) {
        stmt.free();
        return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado" });
    }
    const [modulo, alvo, status] = stmt.get();
    stmt.free();

    if (!statusAprovado(status)) {
        return res.status(403).json({ sucesso: false, erro: "Pagamento ainda não confirmado" });
    }

    try {
        let dados;
        if (modulo.toUpperCase() === 'CNPJ') {
            const cnpjLimpo = alvo.replace(/\D/g, '');
            const r = await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
            dados = r.data;
        } else if (modulo.toUpperCase() === 'CEP') {
            const cepLimpo = alvo.replace(/\D/g, '');
            const r = await axios.get(`https://brasilapi.com.br/api/cep/v1/${cepLimpo}`);
            dados = r.data;
        } else {
            return res.status(400).json({ sucesso: false, erro: "Módulo inválido" });
        }
        res.json({ sucesso: true, dados });
    } catch (e) {
        console.error("Erro na consulta:", e.response?.data || e.message);
        res.status(500).json({ sucesso: false, erro: "Erro ao consultar dados" });
    }
});

// ADMIN
app.get('/api/admin/pedidos', exigirLogin, (req, res) => {
    if (!db) return res.status(500).json({ sucesso: false, erro: "Banco indisponível" });
    let resultado = [];
    let stmt = db.prepare("SELECT txid, modulo, alvo, status, data FROM pedidos ORDER BY id DESC LIMIT 500");
    while (stmt.step()) {
        const [txid, modulo, alvo, status, data] = stmt.get();
        resultado.push({ txid, modulo, alvo, status, data });
    }
    stmt.free();
    res.json(resultado);
});

app.post('/api/admin/aprovar/:txid', exigirLogin, (req, res) => {
    if (db) {
        db.run("UPDATE pedidos SET status = 'aprovado' WHERE txid = ?", [req.params.txid]);
        salvarBanco();
    }
    res.json({ sucesso: true });
});

app.get('/api/admin/estatisticas', exigirLogin, (req, res) => {
    if (!db) return res.status(500).json({ sucesso: false, erro: "Banco indisponível" });

    let stmt = db.prepare("SELECT modulo, status, data FROM pedidos");
    const todos = [];
    while (stmt.step()) {
        const [modulo, status, data] = stmt.get();
        todos.push({ modulo, status, data });
    }
    stmt.free();

    const aprovados = todos.filter(p => statusAprovado(p.status));
    const pendentes = todos.filter(p => !statusAprovado(p.status));

    const porModulo = {};
    aprovados.forEach(p => {
        const m = (p.modulo || 'OUTRO').toUpperCase();
        porModulo[m] = (porModulo[m] || 0) + 1;
    });

    const porDiaMap = {};
    aprovados.forEach(p => {
        const diaStr = (p.data || '').split(',')[0].trim() || 'Data desconhecida';
        porDiaMap[diaStr] = (porDiaMap[diaStr] || 0) + 1;
    });
    const porDia = Object.entries(porDiaMap)
        .map(([dia, quantidade]) => ({ dia, quantidade, receita: quantidade * VALOR_CONSULTA }))
        .sort((a, b) => {
            const [da, ma, aa] = a.dia.split('/');
            const [dB, mb, ab] = b.dia.split('/');
            if (!da || !dB) return 0;
            return new Date(`${ab}-${mb}-${dB}`) - new Date(`${aa}-${ma}-${da}`);
        });

    res.json({
        sucesso: true,
        totalPedidos: todos.length,
        totalAprovados: aprovados.length,
        totalPendentes: pendentes.length,
        receitaTotal: aprovados.length * VALOR_CONSULTA,
        valorConsulta: VALOR_CONSULTA,
        porModulo,
        porDia
    });
});

iniciarBanco().then(() => {
    app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
});
