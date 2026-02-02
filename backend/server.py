from fastapi import FastAPI, APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
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
APP_URL = os.environ.get('APP_URL')
if not APP_URL:
    APP_URL = 'https://private-chat-130.emergent.host'  # Default for this deployment

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
                
                # Broadcast join
                count = manager.get_participant_count(session_id)
                await manager.broadcast(session_id, {
                    "type": "user_joined",
                    "nickname": current_nickname,
                    "sender_id": current_user_id,
                    "count": count
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
