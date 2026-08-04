import sys
import time
import os

def efeito_matrix():
    os.system('clear')
    linhas = [
        "[+] INICIANDO PROTOCOLO MD_BUSCAS v4.2...",
        "[+] ESTABELECENDO CONEXÃO SEGURA COM O SERVIDOR...",
        "[+] CARREGANDO MÓDULOS DE CONSULTAS (CPF, CNPJ, CEP, CNH)...",
        "[+] BYPASS DE SEGURANÇA CONCLUÍDO COM SUCESSO.",
        "[✔] SISTEMA PRONTO. ACESSO LIBERADO."
    ]
    
    for linha in linhas:
        for char in linha:
            sys.stdout.write(char)
            sys.stdout.flush()
            time.sleep(0.02)
        print()
        time.sleep(0.3)
    
    print("\n--------------------------------------------------")
    print(" 🚀 INICIALIZANDO PAINEL WEB NA PORTA 5000...")
    print("--------------------------------------------------\n")
    time.sleep(1)

if __name__ == "__main__":
    efeito_matrix()
    os.system('python app.py')
