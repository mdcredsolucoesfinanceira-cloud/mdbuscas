from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import requests
import re
import sqlite3
from datetime import datetime

app = Flask(__name__, static_folder='public')
CORS(app)

# Configuração do Banco de Dados SQLite para salvar tudo certinho
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

# Rota para registrar uma nova consulta e salvar no banco
@app.route('/api/registrar', methods=['POST'])
def registrar():
    dados = request.json
    modulo = dados.get('modulo')
    alvo = dados.get('alvo')
    data_hora = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    conn = sqlite3.connect('dados.db')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO consultas (modulo, alvo, data_hora, status) VALUES (?, ?, ?, ?)',
                   (modulo, alvo, data_hora, 'Sucesso'))
    conn.commit()
    conn.close()
    
    return jsonify({"status": "sucesso"})

# Rota de Estatísticas e Gestão para a Dashboard do Admin
@app.route('/api/admin/dados', methods=['GET'])
def admin_dados():
    conn = sqlite3.connect('dados.db')
    cursor = conn.cursor()
    
    # Total de puxadas
    cursor.execute('SELECT COUNT(*) FROM consultas')
    total_puxadas = cursor.fetchone()[0]
    
    # Puxadas por dia (Hoje)
    hoje = datetime.now().strftime('%Y-%m-%d')
    cursor.execute('SELECT COUNT(*) FROM consultas WHERE data_hora LIKE ?', (hoje + '%',))
    puxadas_hoje = cursor.fetchone()[0]
    
    # Puxadas por mês (Mês atual)
    mes_atual = datetime.now().strftime('%Y-%m')
    cursor.execute('SELECT COUNT(*) FROM consultas WHERE data_hora LIKE ?', (mes_atual + '%',))
    puxadas_mes = cursor.fetchone()[0]
    
    # Faturamento Total
    cursor.execute('SELECT SUM(valor) FROM faturamento')
    fat_total = cursor.fetchone()[0] or 0.0
    
    # Faturamento do Dia
    cursor.execute('SELECT SUM(valor) FROM faturamento WHERE data_hora LIKE ?', (hoje + '%',))
    fat_hoje = cursor.fetchone()[0] or 0.0
    
    # Histórico de consultas recentes
    cursor.execute('SELECT modulo, alvo, data_hora, status FROM consultas ORDER BY id DESC LIMIT 20')
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

# Rota de CEP (BrasilAPI)
@app.route('/api/cep/<cep>', methods=['GET'])
def consultar_cep(cep):
    cep_limpo = re.sub(r"\D", "", cep)
    if len(cep_limpo) != 8:
        return jsonify({"erro": "CEP inválido."}), 400
    try:
        res = requests.get(f"https://brasilapi.com.br/api/cep/v2/{cep_limpo}", timeout=5)
        if res.status_code != 200:
            return jsonify({"erro": "CEP não encontrado."}), 404
        return jsonify(res.json())
    except:
        return jsonify({"erro": "Erro na consulta."}), 500

# Rota de CNPJ (BrasilAPI/ReceitaWS)
@app.route('/api/cnpj/<cnpj>', methods=['GET'])
def consultar_cnpj(cnpj):
    cnpj_limpo = re.sub(r"\D", "", cnpj)
    if len(cnpj_limpo) != 14:
        return jsonify({"erro": "CNPJ inválido."}), 400
    try:
        res = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_limpo}", timeout=10)
        if res.status_code != 200:
            res = requests.get(f"https://www.receitaws.com.br/v1/cnpj/{cnpj_limpo}", timeout=10)
        if res.status_code != 200:
            return jsonify({"erro": "CNPJ não encontrado."}), 404
        return jsonify(res.json())
    except:
        return jsonify({"erro": "Erro na consulta."}), 500

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/admin')
def admin_dashboard():
    return send_from_directory('public', 'admin.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
