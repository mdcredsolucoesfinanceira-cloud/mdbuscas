from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import requests
import re
import os

app = Flask(__name__, static_folder='public')
CORS(app)

# Armazenamento simples em memória para estatísticas do Admin
stats = {
    "faturamento": 0.0,
    "total_puxadas": 0,
    "puxadas_cpf": 0,
    "puxadas_cnpj": 0
}

# ROTA DE CEP (Usando BrasilAPI)
@app.route('/api/cep/<cep>', methods=['GET'])
def consultar_cep(cep):
    cep_limpo = re.sub(r"\D", "", cep)
    if len(cep_limpo) != 8:
        return jsonify({"erro": "CEP deve conter 8 dígitos."}), 400
    try:
        res = requests.get(f"https://brasilapi.com.br/api/cep/v2/{cep_limpo}", timeout=5)
        if res.status_code != 200:
            return jsonify({"erro": "CEP não encontrado."}), 404
        
        stats["total_puxadas"] += 1
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"erro": "Erro ao consultar CEP.", "detalhes": str(e)}), 500

# ROTA DE CNPJ (Usando ReceitaWS / BrasilAPI)
@app.route('/api/cnpj/<cnpj>', methods=['GET'])
def consultar_cnpj(cnpj):
    cnpj_limpo = re.sub(r"\D", "", cnpj)
    if len(cnpj_limpo) != 14:
        return jsonify({"erro": "CNPJ deve conter 14 dígitos."}), 400
    try:
        # Tentativa via BrasilAPI (Gratuita e rápida)
        res = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_limpo}", timeout=10)
        if res.status_code != 200:
            # Fallback para ReceitaWS
            res = requests.get(f"https://www.receitaws.com.br/v1/cnpj/{cnpj_limpo}", timeout=10)
            
        if res.status_code != 200:
            return jsonify({"erro": "CNPJ não encontrado."}), 404
            
        stats["total_puxadas"] += 1
        stats["puxadas_cnpj"] += 1
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"erro": "Erro ao consultar base de CNPJ.", "detalhes": str(e)}), 500

# ROTA DE ESTATÍSTICAS PARA O ADMIN
@app.route('/api/admin/stats', methods=['GET'])
def get_stats():
    return jsonify(stats)

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/admin')
def admin_dashboard():
    return send_from_directory('public', 'admin.html')

if __name__ == '__main__':
    print("Servidor MD BUSCAS rodando com APIs integradas...")
    app.run(host='0.0.0.0', port=5000, debug=True)
