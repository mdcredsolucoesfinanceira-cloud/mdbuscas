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

// Criar Pix corrigido para extrair o código de qualquer formato da GoatPay
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const { cnpj } = req.body;
        const externalRef = 'pedido_' + Math.random().toString(36).substring(2, 12);
        
        const response = await axios.post(GOATPAY_ENDPOINT, {
            amount: 10.00,
            description: "Consulta CNPJ MD BUSCAS",
            externalReference: externalRef
        }, {
            headers: { 'X-API-Key': GOATPAY_API_KEY, 'Content-Type': 'application/json' }
        });

        console.log("Resposta GoatPay:", JSON.stringify(response.data));

        const resData = response.data.data || response.data;
        // Varre todas as possibilidades de onde a GoatPay pode colocar o código Pix e a imagem
        const qrcode = resData.copyPaste || resData.pixCode || resData.qrcode || resData.emv || "";
        const qrImage = resData.qrCodeBase64 || resData.qrcode_image || `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrcode)}`;
        const txid = resData.txid || resData.id || resData.referenceId || externalRef;

        if (db) {
            db.run("INSERT INTO pedidos (txid, modulo, alvo, status, data) VALUES (?, ?, ?, ?, ?)",
                [txid, "CNPJ", cnpj || externalRef, 'pendente', new Date().toLocaleString()]);
            salvarBanco();
        }

        res.json({ 
            sucesso: true, 
            txid, 
            qrcode: qrcode, 
            qrcode_image: qrImage 
        });
    } catch (e) {
        console.error("Erro na API da Goatpay:", e.response?.data || e.message);
        res.status(500).json({ sucesso: false, erro: "Erro na API da goatpay" });
    }
});

// Listar pedidos pendentes no admin
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

// Aprovar pedido manual
app.get('/api/admin/aprovar/:txid', (req, res) => {
    const txid = req.params.txid;
    if (db) {
        db.run("UPDATE pedidos SET status = 'aprovado' WHERE txid = ? OR alvo = ?", [txid, txid]);
        salvarBanco();
    }
    res.json({ sucesso: true });
});

// Status para o cliente checar
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

// Consulta CNPJ combinando ReceitaWS + BrasilAPI
app.get('/api/consulta/cnpj/:cnpj', async (req, res) => {
    let cnpjLimpo = req.params.cnpj.replace(/\D/g, '');
    let resultadoFinal = { sucesso: false };

    try {
        const respBrasil = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
        if (respBrasil.data) {
            resultadoFinal = {
                sucesso: true,
                fonte: "BrasilAPI + ReceitaWS",
                razao_social: respBrasil.data.razao_social || respBrasil.data.nome_fantasia,
                nome_fantasia: respBrasil.data.nome_fantasia,
                cnpj: respBrasil.data.cnpj,
                situacao: respBrasil.data.descricao_situacao_cadastral || respBrasil.data.situacao,
                abertura: respBrasil.data.data_inicio_atividade,
                porte: respBrasil.data.porte,
                natureza_juridica: respBrasil.data.natureza_juridica,
                atividade_principal: respBrasil.data.cnae_fiscal_descricao,
                logradouro: `${respBrasil.data.descricao_tipo_de_logradouro || ''} ${respBrasil.data.logradouro}, ${respBrasil.data.numero} - ${respBrasil.data.bairro}, ${respBrasil.data.municipio} - ${respBrasil.data.uf}`,
                cep: respBrasil.data.cep,
                telefone: respBrasil.data.ddd_telefone_1,
                email: respBrasil.data.email
            };
        }
    } catch (err) {}

    try {
        const respReceita = await axios.get(`https://www.receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
        if (respReceita.data && respReceita.data.status === "OK") {
            const r = respReceita.data;
            resultadoFinal = {
                sucesso: true,
                fonte: "ReceitaWS",
                razao_social: r.nome,
                nome_fantasia: r.fantasia,
                cnpj: r.cnpj,
                situacao: r.situacao,
                abertura: r.abertura,
                porte: r.porte,
                natureza_juridica: r.natureza_juridica,
                atividade_principal: r.atividade_principal?.[0]?.text || "",
                logradouro: `${r.logradouro}, ${r.numero} - ${r.bairro}, ${r.municipio} - ${r.uf}`,
                cep: r.cep,
                telefone: r.telefone,
                email: r.email
            };
        }
    } catch (err2) {}

    if (resultadoFinal.sucesso) {
        res.json(resultadoFinal);
    } else {
        res.status(400).json({ sucesso: false, erro: "CNPJ não encontrado." });
    }
});

iniciarBanco().then(() => {
    app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
});
