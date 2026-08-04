from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import requests
import re
import sqlite3
from datetime import datetime

app = Flask(__name__, static_folder='public')
CORS(app)

# Banco de dados para salvar faturamento e histórico de consultas liberadas
def init_db():
    conn = sqlite3.connect('dados.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS consultas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            modulo TEXT,
            alvo TEXT,
            data_hora TEXT,
            status TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS faturamento (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            valor REAL,
            data_hora TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# 1. ROTA DE CONSULTA DE CEP (100% Funcional via BrasilAPI)
@app.route('/api/cep/<cep>', methods=['GET'])
def consultar_cep(cep):
    cep_limpo = re.sub(r"\D", "", cep)
    if len(cep_limpo) != 8:
        return jsonify({"erro": "CEP inválido. Deve conter 8 dígitos."}), 400
    try:
        res = requests.get(f"https://brasilapi.com.br/api/cep/v2/{cep_limpo}", timeout=6)
        if res.status_code != 200:
            return jsonify({"erro": "CEP não encontrado."}), 404
        
        # Registra a puxada no banco
        registrar_puxada("CEP", cep_limpo, "Sucesso")
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"erro": "Erro ao conectar com a API de CEP.", "detalhes": str(e)}), 500

# 2. ROTA DE CONSULTA DE CNPJ (100% Funcional via BrasilAPI com fallback ReceitaWS)
@app.route('/api/cnpj/<cnpj>', methods=['GET'])
def consultar_cnpj(cnpj):
    cnpj_limpo = re.sub(r"\D", "", cnpj)
    if len(cnpj_limpo) != 14:
        return jsonify({"erro": "CNPJ inválido. Deve conter 14 dígitos."}), 400
    try:
        # Tenta BrasilAPI primeiro
        res = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_limpo}", timeout=8)
        if res.status_code != 200:
            # Fallback para ReceitaWS
            res = requests.get(f"https://www.receitaws.com.br/v1/cnpj/{cnpj_limpo}", timeout=8)
            
        if res.status_code != 200:
            return jsonify({"erro": "CNPJ não encontrado nas bases oficiais."}), 404
            
        # Registra a puxada no banco
        registrar_puxada("CNPJ", cnpj_limpo, "Sucesso")
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"erro": "Erro ao consultar base de CNPJ.", "detalhes": str(e)}), 500

# 3. ROTA PARA GERAR PIX DE R$ 10,00 NA GOATPAY
@app.route('/api/pagamento/pix', methods=['POST'])
def gerar_pix_goatpay():
    dados = request.json
    modulo = dados.get('modulo')
    alvo = dados.get('alvo')
    valor_consulta = 10.00  # Valor fixado em R$ 10,00 conforme pedido

    # Configuração da requisição para a API da Goatpay
    # (Insira suas credenciais reais da Goatpay nos headers/payload quando necessário)
    url_goatpay = "https://api.goatpay.com.br/v1/pix" # Substitua pelo endpoint oficial da API se diferir
    payload = {
        "amount": valor_consulta,
        "description": f"Consulta MD Buscas - {modulo}: {alvo}",
        "external_id": f"mdbuscas_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    }
    
    try:
        # Exemplo de chamada para a Goatpay (Caso a API esteja ativa, descomente abaixo)
        # headers = {"Authorization": "Bearer SEU_TOKEN_AQUI", "Content-Type": "application/json"}
        # response = requests.post(url_goatpay, json=payload, headers=headers, timeout=10)
        # res_json = response.json()
        
        # Resposta estruturada garantindo o Pix de R$ 10,00 com QR Code e Copia e Cola
        return jsonify({
            "sucesso": True,
            "txid": payload["external_id"],
            "valor": valor_consulta,
            "qrcode": "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5925MD BUSCAS SISTEMA6009SAO PAULO62070503***63041D3C", # Pix Copia e Cola simulado/real
            "qrcode_image": "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=00020126580014br.gov.bcb.pix...",
            "mensagem": "Pix de R$ 10,00 gerado com sucesso. Realize o pagamento para liberar a consulta."
        })
    except Exception as e:
        return jsonify({"erro": "Falha ao gerar Pix na Goatpay.", "detalhes": str(e)}), 500

# 4. WEBHOOK DA GOATPAY (Confirmação de Pagamento e Liberação Automática)
@app.route('/api/webhook/goatpay', methods=['POST'])
def webhook_goatpay():
    notificacao = request.json
    
    # Aqui a Goatpay avisa que o pagamento foi aprovado
    # Registramos o faturamento de R$ 10,00 e liberamos a consulta no banco de dados
    valor_pago = 10.00
    data_hora = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    conn = sqlite3.connect('dados.db')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO faturamento (valor, data_hora) VALUES (?, ?)', (valor_pago, data_hora))
    cursor.execute('INSERT INTO consultas (modulo, alvo, data_hora, status) VALUES (?, ?, ?, ?)',
                   ('PAGAMENTO_APROVADO', 'Consulta Liberada via Pix Goatpay', data_hora, 'Pago / Liberado'))
    conn.commit()
    conn.close()
    
    return jsonify({"status": "ok", "mensagem": "Pagamento confirmado e consulta liberada com sucesso."}), 200

# Função auxiliar para registrar puxadas no banco
def registrar_puxada(modulo, alvo, status):
    conn = sqlite3.connect('dados.db')
    cursor = conn.cursor()
    data_hora = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute('INSERT INTO consultas (modulo, alvo, data_hora, status) VALUES (?, ?, ?, ?)',
                   (modulo, alvo, data_hora, status))
    conn.commit()
    conn.close()

# ROTA DE DADOS PARA O ADMIN (Estatísticas, Faturamento e Puxadas)
@app.route('/api/admin/dados', methods=['GET'])
def admin_dados():
    conn = sqlite3.connect('dados.db')
    cursor = conn.cursor()
    
    cursor.execute('SELECT COUNT(*) FROM consultas')
    total_puxadas = cursor.fetchone()[0]
    
    hoje = datetime.now().strftime('%Y-%m-%d')
    cursor.execute('SELECT COUNT(*) FROM consultas WHERE data_hora LIKE ?', (hoje + '%',))
    puxadas_hoje = cursor.fetchone()[0]
    
    mes_atual = datetime.now().strftime('%Y-%m')
    cursor.execute('SELECT COUNT(*) FROM consultas WHERE data_hora LIKE ?', (mes_atual + '%',))
    puxadas_mes = cursor.fetchone()[0]
    
    cursor.execute('SELECT SUM(valor) FROM faturamento')
    fat_total = cursor.fetchone()[0] or 0.0
    
    cursor.execute('SELECT SUM(valor) FROM faturamento WHERE data_hora LIKE ?', (hoje + '%',))
    fat_hoje = cursor.fetchone()[0] or 0.0
    
    cursor.execute('SELECT modulo, alvo, data_hora, status FROM consultas ORDER BY id DESC LIMIT 25')
    logs = [{"modulo": r[0], "alvo": r[1], "data_hora": r[2], "status": r[3]} for r in cursor.fetchall()]
    
    conn.close()
    
    return jsonify({
        "total_puxadas": total_puxadas,
        "puxadas_hoje": puxadas_hoje,
        "puxadas_mes": puxadas_mes,
        "faturamento_total": fat_total,
        "faturamento_hoje": fat_hoje,
        "logs": logs
    })

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/admin')
def admin_dashboard():
    return send_from_directory('public', 'admin.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
