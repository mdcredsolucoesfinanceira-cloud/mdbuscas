const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const session = require('express-session');
const webpush = require('web-push');
const { createClient } = require('@libsql/client');
const app = express();
const PORT = process.env.PORT || 3000;

const GOATPAY_API_KEY = process.env.GOATPAY_API_KEY;
const GOATPAY_WEBHOOK_SECRET = process.env.GOATPAY_WEBHOOK_SECRET;
const GOATPAY_ENDPOINT = "https://api.goatpay.com.br/v1/payment-pix/create";

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET || 'mude_essa_chave_no_render';

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@mdbuscas.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const db = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN
});

const PRECOS = {
    CNPJ: 10.00,
    CEP: 3.00,
    FIPE: 3.00,
    CNAE: 3.00,
    BANCO: 3.00,
    FERIADOS: 3.00
};
function valorPorModulo(moduloUpper) {
    return PRECOS[moduloUpper] !== undefined ? PRECOS[moduloUpper] : 10.00;
}

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

async function iniciarBanco() {
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT,
            goatpay_id TEXT,
            modulo TEXT,
            alvo TEXT,
            status TEXT,
            data TEXT
        );`);
        try {
            await db.execute(`ALTER TABLE pedidos ADD COLUMN goatpay_id TEXT;`);
        } catch (e) { /* já existe */ }

        await db.execute(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE,
            subscription_json TEXT
        );`);

        console.log("Banco Turso conectado e pronto.");
    } catch (e) {
        console.error("Erro ao conectar no banco Turso:", e.message);
    }
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

async function notificarNovaConsulta(modulo, alvo, valor) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
    try {
        const result = await db.execute("SELECT endpoint, subscription_json FROM push_subscriptions");
        const payload = JSON.stringify({
            title: '💰 Nova consulta paga!',
            body: `${modulo} — ${alvo} — R$ ${valor.toFixed(2).replace('.', ',')}`
        });
        for (const row of result.rows) {
            try {
                const sub = JSON.parse(row.subscription_json);
                await webpush.sendNotification(sub, payload);
            } catch (e) {
                if (e.statusCode === 410 || e.statusCode === 404) {
                    await db.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [row.endpoint] });
                } else {
                    console.error("Erro ao enviar push:", e.message);
                }
            }
        }
    } catch (e) {
        console.error("Erro ao notificar:", e.message);
    }
}

async function validarAlvo(moduloUpper, alvo) {
    if (moduloUpper === 'CNPJ') {
        const limpo = alvo.replace(/\D/g, '');
        if (limpo.length !== 14) return { ok: false, erro: "CNPJ inválido. Digite os 14 números." };
        try { await axios.get(`https://receitaws.com.br/v1/cnpj/${limpo}`); }
        catch (e) { return { ok: false, erro: "CNPJ não encontrado. Confira o número digitado." }; }
        return { ok: true };
    }
    if (moduloUpper === 'CEP') {
        const limpo = alvo.replace(/\D/g, '');
        if (limpo.length !== 8) return { ok: false, erro: "CEP inválido. Digite os 8 números." };
        try { await axios.get(`https://brasilapi.com.br/api/cep/v1/${limpo}`); }
        catch (e) { return { ok: false, erro: "CEP não encontrado. Confira o número digitado." }; }
        return { ok: true };
    }
    if (moduloUpper === 'FIPE') {
        const codigo = alvo.trim();
        if (!codigo) return { ok: false, erro: "Digite o código FIPE do veículo." };
        try { await axios.get(`https://brasilapi.com.br/api/fipe/preco/v1/${encodeURIComponent(codigo)}`); }
        catch (e) { return { ok: false, erro: "Código FIPE não encontrado. Confira o valor digitado." }; }
        return { ok: true };
    }
    if (moduloUpper === 'CNAE') {
        const limpo = alvo.replace(/\D/g, '');
        if (limpo.length !== 7) return { ok: false, erro: "CNAE inválido. Digite os 7 números." };
        try { await axios.get(`https://brasilapi.com.br/api/cnae/v1/${limpo}`); }
        catch (e) { return { ok: false, erro: "CNAE não encontrado. Confira o código digitado." }; }
        return { ok: true };
    }
    if (moduloUpper === 'BANCO') {
        const limpo = alvo.replace(/\D/g, '');
        if (!limpo) return { ok: false, erro: "Digite o código do banco (ex: 001)." };
        try { await axios.get(`https://brasilapi.com.br/api/banks/v1/${limpo}`); }
        catch (e) { return { ok: false, erro: "Código de banco não encontrado. Confira o valor digitado." }; }
        return { ok: true };
    }
    if (moduloUpper === 'FERIADOS') {
        const ano = alvo.trim();
        if (!/^\d{4}$/.test(ano)) return { ok: false, erro: "Digite um ano válido, ex: 2026." };
        try { await axios.get(`https://brasilapi.com.br/api/feriados/v1/${ano}`); }
        catch (e) { return { ok: false, erro: "Não foi possível buscar feriados desse ano." }; }
        return { ok: true };
    }
    return { ok: false, erro: "Módulo inválido" };
}

async function buscarDados(moduloUpper, alvo) {
    if (moduloUpper === 'CNPJ') {
        const limpo = alvo.replace(/\D/g, '');
        const resultado = { fonte_receitaws: null, fonte_brasilapi: null };
        try {
            const r1 = await axios.get(`https://receitaws.com.br/v1/cnpj/${limpo}`);
            resultado.fonte_receitaws = r1.data;
        } catch (e) { }
        try {
            const r2 = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${limpo}`);
            resultado.fonte_brasilapi = r2.data;
        } catch (e) { }
        return resultado;
    }
    if (moduloUpper === 'CEP') {
        const limpo = alvo.replace(/\D/g, '');
        const r = await axios.get(`https://brasilapi.com.br/api/cep/v1/${limpo}`);
        return r.data;
    }
    if (moduloUpper === 'FIPE') {
        const r = await axios.get(`https://brasilapi.com.br/api/fipe/preco/v1/${encodeURIComponent(alvo.trim())}`);
        return r.data;
    }
    if (moduloUpper === 'CNAE') {
        const limpo = alvo.replace(/\D/g, '');
        const r = await axios.get(`https://brasilapi.com.br/api/cnae/v1/${limpo}`);
        return r.data;
    }
    if (moduloUpper === 'BANCO') {
        const limpo = alvo.replace(/\D/g, '');
        const r = await axios.get(`https://brasilapi.com.br/api/banks/v1/${limpo}`);
        return r.data;
    }
    if (moduloUpper === 'FERIADOS') {
        const r = await axios.get(`https://brasilapi.com.br/api/feriados/v1/${alvo.trim()}`);
        return r.data;
    }
    throw new Error("Módulo inválido");
}

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

app.get('/api/push/public-key', exigirLogin, (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

app.post('/api/push/subscribe', exigirLogin, async (req, res) => {
    try {
        const sub = req.body;
        if (!sub || !sub.endpoint) {
            return res.status(400).json({ sucesso: false, erro: "Assinatura inválida" });
        }
        await db.execute({
            sql: "INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription_json) VALUES (?, ?)",
            args: [sub.endpoint, JSON.stringify(sub)]
        });
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao salvar subscription:", e.message);
        res.status(500).json({ sucesso: false, erro: "Erro ao salvar" });
    }
});

app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const { modulo, alvo } = req.body;
        if (!modulo || !alvo) {
            return res.status(400).json({ sucesso: false, erro: "Módulo e alvo são obrigatórios" });
        }
        const moduloUpper = modulo.toUpperCase();

        const validacao = await validarAlvo(moduloUpper, alvo);
        if (!validacao.ok) {
            return res.status(400).json({ sucesso: false, erro: validacao.erro });
        }

        const valor = valorPorModulo(moduloUpper);
        const externalRef = 'pedido_' + Math.random().toString(36).substring(2, 12);
        const response = await axios.post(GOATPAY_ENDPOINT, {
            amount: valor,
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

        await db.execute({
            sql: "INSERT INTO pedidos (txid, goatpay_id, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?, ?)",
            args: [externalRef, goatpayId, modulo, alvo, 'pendente', new Date().toLocaleString()]
        });

        res.json({ sucesso: true, txid: externalRef, qrcode: copyPaste, qrcode_image: qrcodeImage });
    } catch (e) {
        console.error("Erro na API da Goatpay:", e.response?.data || e.message);
        res.status(500).json({ sucesso: false, erro: "Erro na API da Goatpay" });
    }
});

app.post('/api/webhook/goatpay', async (req, res) => {
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

    try {
        if (goatpayId && (evento === 'payment.paid' || eventData.status === 'PAID')) {
            await db.execute({
                sql: "UPDATE pedidos SET status = 'aprovado' WHERE goatpay_id = ?",
                args: [goatpayId]
            });
            console.log(`Pedido com goatpay_id ${goatpayId} aprovado via webhook!`);

            const result = await db.execute({
                sql: "SELECT modulo, alvo FROM pedidos WHERE goatpay_id = ?",
                args: [goatpayId]
            });
            if (result.rows.length > 0) {
                const { modulo, alvo } = result.rows[0];
                const valor = valorPorModulo((modulo || '').toUpperCase());
                await notificarNovaConsulta(modulo, alvo, valor);
            }
        }
    } catch (e) {
        console.error("Erro ao atualizar pedido via webhook:", e.message);
    }

    res.status(200).send('OK');
});

app.get('/api/pagamento/status/:txid', async (req, res) => {
    try {
        const result = await db.execute({
            sql: "SELECT status FROM pedidos WHERE txid = ?",
            args: [req.params.txid]
        });
        const status = result.rows.length > 0 ? result.rows[0].status : 'pendente';
        res.json({ pago: statusAprovado(status), liberadoAdmin: statusAprovado(status) });
    } catch (e) {
        console.error("Erro ao consultar status:", e.message);
        res.status(500).json({ pago: false, liberadoAdmin: false });
    }
});

app.get('/api/consulta/:txid', async (req, res) => {
    const { txid } = req.params;
    try {
        const result = await db.execute({
            sql: "SELECT modulo, alvo, status FROM pedidos WHERE txid = ?",
            args: [txid]
        });

        if (result.rows.length === 0) {
            return res.status(404).json({ sucesso: false, erro: "Pedido não encontrado" });
        }

        const { modulo, alvo, status } = result.rows[0];

        if (!statusAprovado(status)) {
            return res.status(403).json({ sucesso: false, erro: "Pagamento ainda não confirmado" });
        }

        const dados = await buscarDados(modulo.toUpperCase(), alvo);
        res.json({ sucesso: true, dados });
    } catch (e) {
        console.error("Erro na consulta:", e.response?.data || e.message);
        res.status(500).json({ sucesso: false, erro: "Erro ao consultar dados" });
    }
});

app.get('/api/admin/pedidos', exigirLogin, async (req, res) => {
    try {
        const result = await db.execute(
            "SELECT txid, modulo, alvo, status, data FROM pedidos ORDER BY id DESC LIMIT 500"
        );
        res.json(result.rows);
    } catch (e) {
        console.error("Erro ao listar pedidos:", e.message);
        res.status(500).json({ sucesso: false, erro: "Banco indisponível" });
    }
});

app.post('/api/admin/aprovar/:txid', exigirLogin, async (req, res) => {
    try {
        await db.execute({
            sql: "UPDATE pedidos SET status = 'aprovado' WHERE txid = ?",
            args: [req.params.txid]
        });

        const result = await db.execute({
            sql: "SELECT modulo, alvo FROM pedidos WHERE txid = ?",
            args: [req.params.txid]
        });
        if (result.rows.length > 0) {
            const { modulo, alvo } = result.rows[0];
            const valor = valorPorModulo((modulo || '').toUpperCase());
            await notificarNovaConsulta(modulo, alvo, valor);
        }

        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao aprovar pedido:", e.message);
        res.status(500).json({ sucesso: false, erro: "Erro ao aprovar" });
    }
});

app.get('/api/admin/estatisticas', exigirLogin, async (req, res) => {
    try {
        const result = await db.execute("SELECT modulo, status, data FROM pedidos");
        const todos = result.rows;

        const aprovados = todos.filter(p => statusAprovado(p.status));
        const pendentes = todos.filter(p => !statusAprovado(p.status));

        const porModulo = {};
        aprovados.forEach(p => {
            const m = (p.modulo || 'OUTRO').toUpperCase();
            porModulo[m] = (porModulo[m] || 0) + 1;
        });

        const receitaTotal = aprovados.reduce((soma, p) => soma + valorPorModulo((p.modulo || '').toUpperCase()), 0);

        const porDiaMap = {};
        aprovados.forEach(p => {
            const diaStr = (p.data || '').split(',')[0].trim() || 'Data desconhecida';
            if (!porDiaMap[diaStr]) porDiaMap[diaStr] = { quantidade: 0, receita: 0 };
            porDiaMap[diaStr].quantidade += 1;
            porDiaMap[diaStr].receita += valorPorModulo((p.modulo || '').toUpperCase());
        });
        const porDia = Object.entries(porDiaMap)
            .map(([dia, v]) => ({ dia, quantidade: v.quantidade, receita: v.receita }))
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
            receitaTotal,
            precos: PRECOS,
            porModulo,
            porDia
        });
    } catch (e) {
        console.error("Erro nas estatísticas:", e.message);
        res.status(500).json({ sucesso: false, erro: "Banco indisponível" });
    }
});

iniciarBanco().then(() => {
    app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
});
