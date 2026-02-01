# Chat Stealth - PRD (Product Requirements Document)

## Visão Geral
Chat Stealth é um aplicativo de chat privado focado em privacidade máxima, com mensagens autodestrutivas, gravação de áudio, proteção anti-screenshot e upgrade para modo Pro via Stripe.

## Funcionalidades Implementadas

### 1. Sessões Anônimas
- Criação de sessões sem necessidade de login/cadastro
- Códigos de 6 caracteres para compartilhamento
- Link de convite copiado automaticamente para área de transferência
- Sessões expiram após 24 horas

### 2. Mensagens Autodestrutivas
- **Modo Free**: Mensagens desaparecem após 5 minutos
- **Modo Pro**: Mensagens desaparecem após 30 minutos
- Timer visual mostrando tempo restante em cada mensagem
- Limpeza automática de mensagens expiradas no backend

### 3. Chat em Tempo Real
- WebSocket para comunicação bidirecional
- Indicador de participantes online
- Status de conexão visível na interface
- Reconexão automática em caso de desconexão

### 4. Mensagens de Áudio
- Gravação de áudio usando o microfone do dispositivo
- Limite de 1 minuto por gravação
- Reprodução de áudios com indicador de progresso
- Armazenamento em base64 no banco de dados

### 5. Proteção Anti-Screenshot
- Prevenção de captura de tela usando expo-screen-capture
- Tela fica em branco quando app está em background
- Proteção funciona em iOS e Android nativos

### 6. Upgrade Pro (Stripe)
- Checkout via Stripe para upgrade de sessão
- Preço: R$9,99 por sessão
- Mensagens passam a durar 30 minutos após upgrade
- Webhook para processamento automático do pagamento

## Arquitetura Técnica

### Frontend (Expo React Native)
- **Framework**: Expo SDK 54
- **Roteamento**: expo-router (file-based)
- **Estado**: React hooks (useState, useEffect)
- **Audio**: expo-av
- **Segurança**: expo-screen-capture
- **Clipboard**: expo-clipboard
- **Pagamentos**: expo-web-browser (Stripe Checkout)

### Backend (FastAPI)
- **Framework**: FastAPI
- **Banco de Dados**: MongoDB
- **WebSocket**: Built-in FastAPI WebSocket
- **Pagamentos**: Stripe Python SDK
- **Background Tasks**: asyncio

### Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | /api/sessions | Criar nova sessão |
| GET | /api/sessions/{code} | Buscar sessão por código |
| GET | /api/sessions/{id}/messages | Listar mensagens |
| POST | /api/messages | Enviar mensagem |
| POST | /api/sessions/{id}/upgrade | Criar checkout Stripe |
| POST | /api/stripe/webhook | Webhook do Stripe |
| WS | /ws/{session_id} | WebSocket para chat |

## Variáveis de Ambiente

### Backend (.env)
```
MONGO_URL=mongodb://localhost:27017/
DB_NAME=stealth_chat
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
```

### Frontend (.env)
```
EXPO_PUBLIC_BACKEND_URL=https://[your-domain].emergent.host
EXPO_PUBLIC_WS_URL=wss://[your-domain].emergent.host
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
```

## Status de Implementação

### ✅ Concluído
- Backend completo com todas as APIs
- Frontend com design moderno e responsivo
- Sistema de sessões anônimas
- Chat em tempo real via WebSocket
- Gravação e reprodução de áudio
- Proteção anti-screenshot
- Integração Stripe para upgrade Pro
- Auto-destruição de mensagens com timer visual

### ⚠️ Pendente
- Roteamento de API na produção (problema de ingress)
- Testes E2E automatizados
- Notificações push

## Como Testar

1. Acesse a URL do app
2. Clique em "CRIAR SESSÃO GRÁTIS"
3. Compartilhe o código/link com outra pessoa
4. Envie mensagens de texto ou áudio
5. Observe as mensagens desaparecerem após 5 minutos
6. Para modo Pro, clique nos "..." e selecione "Upgrade para Pro"
