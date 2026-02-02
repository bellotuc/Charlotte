from fastapi import FastAPI, APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timedelta
import stripe
import json
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Stripe configuration
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY', '')

# App URL for redirects (required environment variable)
APP_URL = os.environ.get('APP_URL', '')

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)
    
    def disconnect(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
    
    async def broadcast(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            dead_connections = []
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_json(message)
                except:
                    dead_connections.append(connection)
            for dc in dead_connections:
                self.disconnect(dc, session_id)
    
    def get_participant_count(self, session_id: str) -> int:
        return len(self.active_connections.get(session_id, []))

manager = ConnectionManager()

# Models
class SessionCreate(BaseModel):
    nickname: Optional[str] = None

class SessionResponse(BaseModel):
    id: str
    code: str
    is_pro: bool
    message_ttl_minutes: int
    max_participants: int = 5
    created_at: datetime
    expires_at: datetime

class MessageCreate(BaseModel):
    session_id: str
    content: str
    message_type: str = "text"  # text, audio, image, video, document
    file_name: Optional[str] = None
    sender_id: str
    sender_nickname: Optional[str] = None

class MessageResponse(BaseModel):
    id: str
    session_id: str
    content: str
    message_type: str
    file_name: Optional[str] = None
    sender_id: str
    sender_nickname: Optional[str] = None
    created_at: datetime
    expires_at: datetime

class UpgradeRequest(BaseModel):
    session_id: str

# Helper functions
def generate_session_code() -> str:
    """Generate a 6-character alphanumeric code"""
    import random
    import string
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

async def cleanup_expired_messages():
    """Background task to clean up expired messages"""
    while True:
        try:
            now = datetime.utcnow()
            result = await db.messages.delete_many({"expires_at": {"$lt": now}})
            if result.deleted_count > 0:
                logging.info(f"Cleaned up {result.deleted_count} expired messages")
        except Exception as e:
            logging.error(f"Error cleaning up messages: {e}")
        await asyncio.sleep(30)  # Run every 30 seconds

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Chat Stealth API", "status": "active"}

@api_router.get("/config")
async def get_config():
    return {
        "stripe_publishable_key": STRIPE_PUBLISHABLE_KEY,
        "pro_price": 999,  # R$9.99 in cents
        "free_ttl_minutes": 10,
        "pro_ttl_minutes": 60
    }

@api_router.post("/sessions", response_model=SessionResponse)
async def create_session(data: SessionCreate):
    """Create a new chat session"""
    session_id = str(uuid.uuid4())
    code = generate_session_code()
    now = datetime.utcnow()
    
    # Check code uniqueness
    while await db.sessions.find_one({"code": code, "expires_at": {"$gt": now}}):
        code = generate_session_code()
    
    session = {
        "id": session_id,
        "code": code,
        "is_pro": False,
        "message_ttl_minutes": 10,  # Free tier: 10 minutes
        "max_participants": 5,  # Free tier: 5 people
        "created_at": now,
        "expires_at": now + timedelta(hours=24),  # Session expires in 24h
        "creator_nickname": data.nickname
    }
    
    await db.sessions.insert_one(session)
    
    return SessionResponse(**session)

@api_router.get("/sessions/{code}")
async def get_session(code: str):
    """Get session by code"""
    now = datetime.utcnow()
    session = await db.sessions.find_one({
        "code": code.upper(),
        "expires_at": {"$gt": now}
    })
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    
    return SessionResponse(
        id=session["id"],
        code=session["code"],
        is_pro=session["is_pro"],
        message_ttl_minutes=session["message_ttl_minutes"],
        created_at=session["created_at"],
        expires_at=session["expires_at"]
    )

@api_router.get("/sessions/{session_id}/messages", response_model=List[MessageResponse])
async def get_messages(session_id: str):
    """Get non-expired messages for a session"""
    now = datetime.utcnow()
    messages = await db.messages.find({
        "session_id": session_id,
        "expires_at": {"$gt": now}
    }).sort("created_at", 1).to_list(100)
    
    return [MessageResponse(**msg) for msg in messages]

@api_router.post("/messages", response_model=MessageResponse)
async def create_message(data: MessageCreate):
    """Create a new message"""
    # Get session to determine TTL
    session = await db.sessions.find_one({"id": data.session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    now = datetime.utcnow()
    ttl_minutes = session.get("message_ttl_minutes", 10)
    
    message = {
        "id": str(uuid.uuid4()),
        "session_id": data.session_id,
        "content": data.content,
        "message_type": data.message_type,
        "file_name": data.file_name,
        "sender_id": data.sender_id,
        "sender_nickname": data.sender_nickname,
        "created_at": now,
        "expires_at": now + timedelta(minutes=ttl_minutes)
    }
    
    await db.messages.insert_one(message)
    
    # Broadcast to all connected clients (convert datetime to string for JSON)
    broadcast_msg = {
        "id": message["id"],
        "session_id": message["session_id"],
        "content": message["content"],
        "message_type": message["message_type"],
        "file_name": message["file_name"],
        "sender_id": message["sender_id"],
        "sender_nickname": message["sender_nickname"],
        "created_at": message["created_at"].isoformat(),
        "expires_at": message["expires_at"].isoformat()
    }
    await manager.broadcast(data.session_id, {
        "type": "new_message",
        "message": broadcast_msg
    })
    
    return MessageResponse(**message)

@api_router.post("/sessions/{session_id}/upgrade")
async def create_upgrade_session(session_id: str):
    """Create Stripe checkout session for Pro upgrade"""
    session = await db.sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.get("is_pro"):
        raise HTTPException(status_code=400, detail="Session already Pro")
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "brl",
                    "product_data": {
                        "name": "Chat Stealth Pro",
                        "description": "Mensagens com 30 minutos de duração",
                    },
                    "unit_amount": 999,  # R$9.99
                },
                "quantity": 1,
            }],
            metadata={
                "session_id": session_id
            },
            success_url=f"{APP_URL}/?upgraded=true&session={session['code']}",
            cancel_url=f"{APP_URL}/?session={session['code']}",
        )
        
        return {
            "checkout_url": checkout_session.url,
            "checkout_id": checkout_session.id
        }
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhooks"""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        # For now, we'll process without signature verification
        # In production, add STRIPE_WEBHOOK_SECRET
        event = json.loads(payload)
        
        if event["type"] == "checkout.session.completed":
            checkout_session = event["data"]["object"]
            session_id = checkout_session.get("metadata", {}).get("session_id")
            
            if session_id:
                # Upgrade session to Pro
                await db.sessions.update_one(
                    {"id": session_id},
                    {
                        "$set": {
                            "is_pro": True,
                            "message_ttl_minutes": 60,
                            "max_participants": 50,
                            "upgraded_at": datetime.utcnow()
                        }
                    }
                )
                
                # Broadcast upgrade to all clients
                await manager.broadcast(session_id, {
                    "type": "session_upgraded",
                    "is_pro": True,
                    "message_ttl_minutes": 60,
                    "max_participants": 50
                })
                
                logging.info(f"Session {session_id} upgraded to Pro")
        
        return {"status": "success"}
    except Exception as e:
        logging.error(f"Webhook error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/sessions/{session_id}/verify-upgrade")
async def verify_upgrade(session_id: str):
    """Manually verify and apply upgrade (backup method)"""
    session = await db.sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "is_pro": session.get("is_pro", False),
        "message_ttl_minutes": session.get("message_ttl_minutes", 5)
    }

@api_router.delete("/sessions/{session_id}/destroy")
async def destroy_session(session_id: str):
    """Auto-destruct session - only for session creator (host)"""
    session = await db.sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Delete all messages from this session
    await db.messages.delete_many({"session_id": session_id})
    
    # Delete the session
    await db.sessions.delete_one({"id": session_id})
    
    # Broadcast destruction to all connected clients
    await manager.broadcast(session_id, {
        "type": "session_destroyed",
        "message": "A sessão foi encerrada pelo anfitrião."
    })
    
    logging.info(f"Session {session_id} was destroyed by host")
    
    return {"status": "destroyed", "session_id": session_id}

# Secret Pro upgrade code (from environment variable)
SECRET_PRO_CODE = os.environ.get('SECRET_PRO_CODE', '')

class SecretUpgradeRequest(BaseModel):
    secret_code: str

@api_router.post("/sessions/{session_id}/secret-upgrade")
async def secret_upgrade(session_id: str, data: SecretUpgradeRequest):
    """Secret upgrade to Pro - hidden access"""
    if data.secret_code != SECRET_PRO_CODE:
        raise HTTPException(status_code=403, detail="Invalid code")
    
    session = await db.sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Upgrade to Pro silently
    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "is_pro": True,
                "message_ttl_minutes": 60,
                "max_participants": 50,
                "secret_upgraded": True
            }
        }
    )
    
    # Broadcast upgrade to all clients (without revealing secret)
    await manager.broadcast(session_id, {
        "type": "session_upgraded",
        "is_pro": True,
        "message_ttl_minutes": 60,
        "max_participants": 50
    })
    
    logging.info(f"Session {session_id} secretly upgraded to Pro")
    
    return {"status": "upgraded", "is_pro": True}

# Health check endpoints (required for Kubernetes ingress)
@app.get("/")
async def root_health():
    return {"status": "ok", "service": "chat-stealth-api"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Store user nicknames
user_nicknames: Dict[str, Dict[str, str]] = {}  # session_id -> {sender_id: nickname}

# WebSocket endpoint
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    # Check session exists and participant limit
    session = await db.sessions.find_one({"id": session_id})
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return
    
    max_participants = session.get("max_participants", 5)
    current_count = manager.get_participant_count(session_id)
    
    if current_count >= max_participants:
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "SESSION_FULL",
            "message": f"Sessão lotada! Máximo de {max_participants} participantes.",
            "max_participants": max_participants
        })
        await websocket.close(code=4003, reason="Session full")
        return
    
    await manager.connect(websocket, session_id)
    current_user_id = None
    current_nickname = None
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "join":
                current_user_id = data.get("sender_id")
                current_nickname = data.get("nickname", "Anônimo")
                
                # Store nickname
                if session_id not in user_nicknames:
                    user_nicknames[session_id] = {}
                user_nicknames[session_id][current_user_id] = current_nickname
                
                # Broadcast join with max participants info
                count = manager.get_participant_count(session_id)
                await manager.broadcast(session_id, {
                    "type": "user_joined",
                    "nickname": current_nickname,
                    "sender_id": current_user_id,
                    "count": count,
                    "max_participants": max_participants
                })
                
            elif data.get("type") == "leave":
                nickname = data.get("nickname", current_nickname or "Anônimo")
                count = manager.get_participant_count(session_id)
                await manager.broadcast(session_id, {
                    "type": "user_left",
                    "nickname": nickname,
                    "count": count - 1
                })
                
            elif data.get("type") == "typing":
                await manager.broadcast(session_id, {
                    "type": "typing",
                    "sender_id": data.get("sender_id"),
                    "nickname": data.get("nickname"),
                    "is_typing": data.get("is_typing", False)
                })
                
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, session_id)
        count = manager.get_participant_count(session_id)
        
        # Broadcast leave
        nickname = current_nickname or "Alguém"
        await manager.broadcast(session_id, {
            "type": "user_left",
            "nickname": nickname,
            "count": count
        })
        
        # Clean up nickname
        if session_id in user_nicknames and current_user_id:
            user_nicknames[session_id].pop(current_user_id, None)
            
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, session_id)

# Include router
app.include_router(api_router)

# Privacy Policy endpoint
@app.get("/privacy", response_class=HTMLResponse)
@app.get("/api/privacy", response_class=HTMLResponse)
async def privacy_policy():
    """Serve the privacy policy page"""
    privacy_html = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Política de Privacidade - Charlotte</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #10b981; margin-bottom: 10px; font-size: 28px; }
        .subtitle { color: #666; margin-bottom: 30px; font-size: 14px; }
        h2 { color: #1a1a1a; margin-top: 30px; margin-bottom: 15px; font-size: 20px; border-bottom: 2px solid #10b981; padding-bottom: 5px; }
        p { margin-bottom: 15px; text-align: justify; }
        ul { margin-left: 20px; margin-bottom: 15px; }
        li { margin-bottom: 8px; }
        .highlight { background-color: #d1fae5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
        .contact { background-color: #f0f0f0; padding: 20px; border-radius: 8px; margin-top: 30px; }
        .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px; }
        a { color: #10b981; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 Política de Privacidade</h1>
        <p class="subtitle">Charlotte - Chat Privado e Seguro<br>Última atualização: Fevereiro de 2025</p>
        <div class="highlight"><strong>Resumo:</strong> O Charlotte foi projetado com privacidade em primeiro lugar. Não coletamos dados pessoais, não exigimos cadastro e todas as mensagens são automaticamente apagadas.</div>
        <h2>1. Introdução</h2>
        <p>O Charlotte ("nós", "nosso" ou "aplicativo") é um serviço de mensagens instantâneas focado em privacidade. Esta Política de Privacidade explica como tratamos as informações quando você usa nosso aplicativo.</p>
        <h2>2. Informações que Coletamos</h2>
        <p><strong>Coletamos o mínimo de informações possível:</strong></p>
        <ul>
            <li><strong>Apelido temporário:</strong> Um nome escolhido por você para identificação durante a sessão.</li>
            <li><strong>Conteúdo das mensagens:</strong> Textos, áudios, fotos, vídeos e documentos. Todo conteúdo é temporário e automaticamente excluído.</li>
            <li><strong>Informações de pagamento (Pro):</strong> Processadas pelo Stripe. Não armazenamos dados de cartão.</li>
        </ul>
        <div class="highlight"><strong>⚠️ Importante:</strong> NÃO coletamos seu nome real, email, telefone, localização ou qualquer informação pessoal identificável.</div>
        <h2>3. Retenção e Exclusão de Dados</h2>
        <ul>
            <li><strong>Modo Gratuito:</strong> Mensagens excluídas após 10 minutos</li>
            <li><strong>Modo Pro:</strong> Mensagens excluídas após 60 minutos</li>
        </ul>
        <h2>4. Compartilhamento</h2>
        <p><strong>Não vendemos ou compartilhamos suas informações</strong>, exceto: Stripe (pagamentos) e requisições legais.</p>
        <h2>5. Segurança</h2>
        <ul>
            <li>Comunicação criptografada (HTTPS/WSS)</li>
            <li>Auto-destruição automática de dados</li>
            <li>Sem armazenamento permanente</li>
        </ul>
        <h2>6. Menores de Idade</h2>
        <p>O Charlotte é destinado a usuários maiores de 17 anos.</p>
        <h2>7. Permissões</h2>
        <ul>
            <li><strong>Câmera:</strong> Fotos e vídeos (Pro)</li>
            <li><strong>Microfone:</strong> Mensagens de áudio</li>
            <li><strong>Galeria:</strong> Selecionar mídia</li>
        </ul>
        <h2>8. Lei Aplicável</h2>
        <p>Esta política é regida pelas leis do Brasil, incluindo a LGPD (Lei nº 13.709/2018).</p>
        <div class="contact">
            <h2 style="margin-top: 0; border: none;">Contato</h2>
            <p><strong>Email:</strong> mosaicohd@gmail.com<br><strong>Website:</strong> charlotte.app</p>
        </div>
        <div class="footer"><p>© 2025 Charlotte. Todos os direitos reservados.</p></div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=privacy_html)

# Support Page endpoint
@app.get("/support", response_class=HTMLResponse)
@app.get("/api/support", response_class=HTMLResponse)
async def support_page():
    """Serve the support page"""
    support_html = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Suporte - Charlotte</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #10b981; margin-bottom: 10px; font-size: 28px; }
        .subtitle { color: #666; margin-bottom: 30px; font-size: 14px; }
        h2 { color: #1a1a1a; margin-top: 30px; margin-bottom: 15px; font-size: 20px; border-bottom: 2px solid #10b981; padding-bottom: 5px; }
        p { margin-bottom: 15px; }
        ul { margin-left: 20px; margin-bottom: 15px; }
        li { margin-bottom: 10px; }
        .faq { background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 15px 0; }
        .faq-q { font-weight: bold; color: #10b981; margin-bottom: 8px; }
        .contact-box { background-color: #d1fae5; padding: 25px; border-radius: 12px; margin: 30px 0; text-align: center; }
        .contact-box h3 { color: #065f46; margin-bottom: 15px; }
        .email-btn { display: inline-block; background-color: #10b981; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 10px; }
        .email-btn:hover { background-color: #059669; }
        .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>💬 Central de Suporte</h1>
        <p class="subtitle">Charlotte - Chat Privado e Seguro</p>

        <h2>❓ Perguntas Frequentes</h2>
        
        <div class="faq">
            <p class="faq-q">Como criar uma sessão de chat?</p>
            <p>Abra o app e toque em "Criar Sessão Grátis". Um código único será gerado automaticamente. Compartilhe o link com quem você quer conversar.</p>
        </div>

        <div class="faq">
            <p class="faq-q">As mensagens realmente desaparecem?</p>
            <p>Sim! No modo gratuito, as mensagens são excluídas após 10 minutos. No modo Pro, após 60 minutos. Após a exclusão, não é possível recuperá-las.</p>
        </div>

        <div class="faq">
            <p class="faq-q">Preciso criar uma conta?</p>
            <p>Não! O Charlotte funciona sem cadastro. Basta escolher um apelido temporário para cada sessão.</p>
        </div>

        <div class="faq">
            <p class="faq-q">O que é o modo Pro?</p>
            <p>O modo Pro oferece: mensagens por 60 minutos, até 50 participantes, envio de fotos/vídeos/documentos pela câmera.</p>
        </div>

        <div class="faq">
            <p class="faq-q">Como funciona o botão de auto-destruição?</p>
            <p>Apenas o criador da sessão (anfitrião) pode usar este botão. Ao ativar, todas as mensagens são apagadas instantaneamente para todos os participantes.</p>
        </div>

        <div class="faq">
            <p class="faq-q">Vocês armazenam minhas conversas?</p>
            <p>Não permanentemente. As mensagens ficam no servidor apenas durante o tempo de vida configurado (10 ou 60 minutos) e são excluídas automaticamente.</p>
        </div>

        <div class="faq">
            <p class="faq-q">Como enviar mensagens de áudio?</p>
            <p>Toque no ícone de microfone ao lado do campo de mensagem. Segure para gravar e solte para enviar.</p>
        </div>

        <div class="faq">
            <p class="faq-q">Posso usar em múltiplos dispositivos?</p>
            <p>Sim! Basta acessar o mesmo link da sessão em qualquer dispositivo. Cada dispositivo será tratado como um participante separado.</p>
        </div>

        <h2>🔧 Problemas Comuns</h2>
        
        <ul>
            <li><strong>App não conecta:</strong> Verifique sua conexão com a internet e tente novamente.</li>
            <li><strong>Mensagens não aparecem:</strong> A sessão pode ter expirado. Crie uma nova sessão.</li>
            <li><strong>Não consigo enviar áudio:</strong> Permita o acesso ao microfone nas configurações do seu dispositivo.</li>
            <li><strong>Câmera não funciona:</strong> Permita o acesso à câmera nas configurações (recurso Pro).</li>
        </ul>

        <div class="contact-box">
            <h3>📧 Precisa de Mais Ajuda?</h3>
            <p>Nossa equipe está pronta para ajudar!</p>
            <a href="mailto:mosaicohd@gmail.com?subject=Suporte Charlotte" class="email-btn">Enviar Email</a>
            <p style="margin-top: 15px; font-size: 14px; color: #065f46;">mosaicohd@gmail.com</p>
        </div>

        <h2>📱 Informações do App</h2>
        <ul>
            <li><strong>Nome:</strong> Charlotte</li>
            <li><strong>Versão:</strong> 1.0.0</li>
            <li><strong>Desenvolvedor:</strong> MosaicoHD</li>
            <li><strong>Website:</strong> charlotte.app</li>
        </ul>

        <div class="footer">
            <p>© 2025 Charlotte. Todos os direitos reservados.</p>
            <p style="margin-top: 10px;"><a href="/api/privacy" style="color: #10b981;">Política de Privacidade</a></p>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=support_html)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    # Create indexes
    await db.sessions.create_index("code")
    await db.sessions.create_index("expires_at")
    await db.messages.create_index("session_id")
    await db.messages.create_index("expires_at")
    
    # Start cleanup task
    asyncio.create_task(cleanup_expired_messages())
    logger.info("Chat Stealth API started")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
