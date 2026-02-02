# 📱 Guia de Publicação do Charlotte na App Store

## ⚠️ ANTES DE COMEÇAR

Você precisa:
1. **Mac** (obrigatório para builds iOS)
2. **Conta Apple Developer** ($99/ano) - https://developer.apple.com
3. **Conta Expo** (grátis) - https://expo.dev

---

## 📋 CHECKLIST DE PREPARAÇÃO

### 1. Informações que você precisa definir

Edite o arquivo `app.json` e substitua:

| Campo | O que colocar | Exemplo |
|-------|---------------|---------|
| `owner` | Seu usuário Expo | `"joaosilva"` |
| `ios.bundleIdentifier` | ID único do app | `"com.seudominio.charlotte"` |
| `android.package` | ID único Android | `"com.seudominio.charlotte"` |
| `extra.eas.projectId` | ID do projeto Expo | (gerado automaticamente) |

### 2. Informações para o `eas.json`

| Campo | O que colocar |
|-------|---------------|
| `appleId` | Seu email da Apple Developer |
| `ascAppId` | ID do app no App Store Connect |
| `appleTeamId` | Seu Team ID da Apple |

---

## 🚀 PASSO A PASSO

### PASSO 1: Instalar ferramentas (no seu computador)

```bash
# Instalar Node.js (se não tiver)
# Baixe de: https://nodejs.org

# Instalar EAS CLI globalmente
npm install -g eas-cli

# Verificar instalação
eas --version
```

### PASSO 2: Baixar o código do app

Você pode baixar o código clicando no botão "Download" na Emergent, ou via git se configurado.

### PASSO 3: Configurar conta Expo

```bash
# Entrar na pasta do frontend
cd frontend

# Fazer login no Expo
eas login

# Configurar o projeto (isso vai gerar o projectId)
eas build:configure
```

### PASSO 4: Criar conta Apple Developer

1. Acesse https://developer.apple.com
2. Clique em "Account"
3. Faça login com seu Apple ID
4. Inscreva-se no Apple Developer Program ($99/ano)
5. Aguarde aprovação (pode levar 24-48h)

### PASSO 5: Criar o App no App Store Connect

1. Acesse https://appstoreconnect.apple.com
2. Clique em "My Apps" → "+"  → "New App"
3. Preencha:
   - **Platforms**: iOS
   - **Name**: Charlotte
   - **Primary Language**: Portuguese (Brazil)
   - **Bundle ID**: Selecione o que você criou
   - **SKU**: charlotte-chat-001 (único)

### PASSO 6: Preparar Assets

#### Ícone do App (OBRIGATÓRIO)
- Tamanho: 1024x1024 pixels
- Formato: PNG sem transparência
- Sem cantos arredondados (a Apple arredonda automaticamente)

#### Screenshots (OBRIGATÓRIO)
Você precisa de screenshots para cada tamanho de tela:

| Dispositivo | Tamanho |
|-------------|---------|
| iPhone 6.7" | 1290 x 2796 |
| iPhone 6.5" | 1284 x 2778 |
| iPhone 5.5" | 1242 x 2208 |
| iPad 12.9" | 2048 x 2732 (se suportar iPad) |

**Dica**: Use o Simulator do Xcode para tirar screenshots.

### PASSO 7: Fazer o Build

```bash
# Na pasta frontend, execute:
eas build --platform ios --profile production

# O processo vai:
# 1. Perguntar sobre credenciais Apple (use as suas)
# 2. Fazer upload do código
# 3. Compilar na nuvem (~15-30 minutos)
# 4. Gerar o arquivo .ipa
```

### PASSO 8: Enviar para App Store

```bash
# Submeter automaticamente
eas submit --platform ios --latest

# OU manualmente via Transporter (app da Apple para Mac)
```

### PASSO 9: Preencher informações no App Store Connect

1. **Descrição do App**:
```
Charlotte - Chat Privado e Seguro

🔒 Privacidade Total
Conversas que desaparecem automaticamente. Sem registro, sem rastros.

✨ Recursos:
• Mensagens auto-destrutivas (10 min grátis / 60 min Pro)
• Áudio mensagens
• Compartilhamento de fotos e vídeos (Pro)
• Proteção anti-screenshot
• Sem necessidade de cadastro

💎 Modo Pro:
• Até 50 participantes
• Envio de documentos
• Câmera integrada

Ideal para conversas confidenciais que precisam de máxima privacidade.
```

2. **Palavras-chave** (separadas por vírgula):
```
chat privado, mensagens secretas, privacidade, chat anônimo, auto destruição, seguro
```

3. **Categoria**: Social Networking

4. **Classificação Etária**: 17+ (devido ao conteúdo anônimo)

5. **Política de Privacidade** (OBRIGATÓRIO):
   - Você PRECISA criar uma página web com sua política de privacidade
   - Pode usar serviços como Termly.io ou criar uma página simples

### PASSO 10: Submeter para Revisão

1. No App Store Connect, vá em "App Store" → "Submit for Review"
2. Responda às perguntas sobre criptografia (marque "No" - já configuramos)
3. Clique em "Submit"

---

## ⏱️ TEMPO DE REVISÃO

- **Primeira submissão**: 24-48 horas (pode ser até 7 dias)
- **Atualizações**: Geralmente 24 horas

---

## ❌ MOTIVOS COMUNS DE REJEIÇÃO

1. **Sem Política de Privacidade** - Crie uma!
2. **Screenshots de baixa qualidade** - Use screenshots reais
3. **Descrição vaga** - Seja específico sobre funcionalidades
4. **Bugs óbvios** - Teste antes de enviar
5. **Sem login mas pede dados** - Não aplicável ao Charlotte

---

## 📞 SUPORTE

- **Expo**: https://docs.expo.dev
- **Apple Developer**: https://developer.apple.com/support
- **App Store Review Guidelines**: https://developer.apple.com/app-store/review/guidelines/

---

## 💰 CUSTOS RESUMIDOS

| Item | Custo | Frequência |
|------|-------|------------|
| Apple Developer | $99 | Anual |
| EAS Build | Grátis* | Por build |
| Submissão | Grátis | Por versão |

*EAS tem plano grátis com limites. Planos pagos disponíveis.

---

Boa sorte com a publicação! 🚀
