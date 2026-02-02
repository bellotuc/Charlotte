# 🔐 Documentação de Criptografia - Charlotte

## Visão Geral

Este documento descreve as práticas de criptografia utilizadas no aplicativo Charlotte para fins de conformidade com a App Store (Export Compliance) e transparência com usuários.

---

## 1. Tipo de Criptografia Utilizada

### ✅ Criptografia de Transporte (TLS/SSL)

O Charlotte utiliza **apenas criptografia de transporte padrão** fornecida pelo sistema operacional:

| Protocolo | Uso | Descrição |
|-----------|-----|-----------|
| **HTTPS (TLS 1.2/1.3)** | API REST | Todas as comunicações HTTP são criptografadas |
| **WSS (WebSocket Secure)** | Chat em tempo real | Conexões WebSocket sobre TLS |

### ❌ O que NÃO utilizamos:

- ❌ Criptografia de ponta a ponta (E2E) personalizada
- ❌ Algoritmos de criptografia proprietários
- ❌ Criptografia de dados em repouso personalizada
- ❌ Bibliotecas de criptografia de terceiros
- ❌ Funções criptográficas além do padrão HTTPS

---

## 2. Export Compliance (App Store)

### Perguntas da Apple e Respostas:

**Q: Does your app use encryption?**
> **A: YES** - O app usa HTTPS/TLS padrão para comunicação de rede.

**Q: Does your app qualify for any of the exemptions provided in Category 5, Part 2 of the U.S. Export Administration Regulations?**
> **A: YES** - O app se qualifica para a isenção.

**Q: Does your app implement any encryption algorithms that are proprietary or not accepted as international standards?**
> **A: NO** - Usamos apenas TLS/SSL padrão do iOS.

**Q: Does your app implement any standard encryption algorithms instead of, or in addition to, using or accessing the encryption in iOS or macOS?**
> **A: NO** - Usamos apenas a criptografia nativa do iOS/macOS.

### Configuração no app.json:

```json
{
  "ios": {
    "config": {
      "usesNonExemptEncryption": false
    },
    "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false
    }
  }
}
```

---

## 3. Detalhes Técnicos

### 3.1 Comunicação API (HTTPS)

```
Cliente (iOS) ←──TLS 1.3──→ Servidor (FastAPI)
```

- **Protocolo**: HTTPS (porta 443)
- **Certificado**: Fornecido pelo provedor de hospedagem
- **Versão TLS**: 1.2 ou superior
- **Implementação**: Nativa do iOS (URLSession/NSURLSession)

### 3.2 WebSocket (WSS)

```
Cliente (iOS) ←──WSS──→ Servidor (WebSocket)
```

- **Protocolo**: WebSocket Secure (WSS)
- **Criptografia**: TLS sobre WebSocket
- **Uso**: Mensagens em tempo real, notificações de presença

### 3.3 Armazenamento Local

| Dado | Método | Criptografia |
|------|--------|--------------|
| Preferências | AsyncStorage | Proteção do iOS (Keychain quando aplicável) |
| Sessão temporária | Memória | Nenhuma (volátil) |
| Mensagens | Servidor apenas | Não armazenadas localmente |

---

## 4. Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTE iOS                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   UI App    │───▶│  Expo/RN    │───▶│  URLSession │     │
│  └─────────────┘    └─────────────┘    └──────┬──────┘     │
│                                                │            │
└────────────────────────────────────────────────┼────────────┘
                                                 │
                                           TLS 1.3
                                                 │
┌────────────────────────────────────────────────┼────────────┐
│                      SERVIDOR                   │            │
│  ┌─────────────┐    ┌─────────────┐    ┌──────▼──────┐     │
│  │   MongoDB   │◀───│   FastAPI   │◀───│    NGINX    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Conformidade Legal

### 5.1 EAR (Export Administration Regulations)

O Charlotte está em conformidade com as regulamentações de exportação dos EUA porque:

1. **Usa apenas criptografia padrão**: TLS/SSL fornecido pelo sistema operacional
2. **Não implementa algoritmos proprietários**: Nenhum código de criptografia personalizado
3. **Qualifica para isenção**: Categoria 5, Parte 2 do EAR

### 5.2 Isenções Aplicáveis

De acordo com o **15 CFR § 740.17**, o app se qualifica para a isenção **ENC** porque:

- Utiliza apenas criptografia para autenticação
- Utiliza criptografia de transporte padrão (HTTPS)
- Não fornece capacidades de criptografia ao usuário final
- Não permite que usuários modifiquem algoritmos de criptografia

---

## 6. Resumo para App Store Connect

### Ao submeter o app, marque:

| Pergunta | Resposta |
|----------|----------|
| Does your app use encryption? | **Yes** |
| Does your app qualify for any exemptions? | **Yes** |
| Does your app contain proprietary encryption? | **No** |
| Does your app contain non-standard encryption? | **No** |

### Justificativa (se solicitada):

```
Charlotte uses only standard HTTPS/TLS encryption provided by iOS 
for network communication. No custom, proprietary, or non-standard 
encryption algorithms are implemented. The app qualifies for the 
encryption exemption under Category 5, Part 2 of the EAR as it uses 
only standard operating system encryption for secure communications.
```

---

## 7. Contato

Para questões sobre criptografia e segurança:

- **Email**: mosaicohd@gmail.com
- **Website**: charlotte.app

---

## 8. Histórico de Revisões

| Versão | Data | Descrição |
|--------|------|-----------|
| 1.0 | Fevereiro 2025 | Documento inicial |

---

*Este documento foi preparado para fins de conformidade com a App Store e regulamentações de exportação.*
