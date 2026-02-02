import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  Vibration,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as ScreenCapture from 'expo-screen-capture';
import * as WebBrowser from 'expo-web-browser';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const WS_URL = process.env.EXPO_PUBLIC_WS_URL || '';

const getApiUrl = () => API_URL;
const getWsUrl = () => WS_URL.replace('https', 'wss').replace('http', 'ws');

interface Message {
  id: string;
  session_id: string;
  content: string;
  message_type: 'text' | 'audio';
  sender_id: string;
  sender_nickname?: string;
  created_at: string;
  expires_at: string;
}

interface SystemMessage {
  id: string;
  type: 'system';
  content: string;
  created_at: string;
}

type ChatItem = Message | SystemMessage;

export default function ChatScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  const sessionId = params.sessionId as string;
  const sessionCode = params.sessionCode as string;
  const [isPro, setIsPro] = useState(params.isPro === 'true');
  const [ttlMinutes, setTtlMinutes] = useState(parseInt(params.ttlMinutes as string) || 5);
  const odaIsiCreator = params.isCreator === 'true';
  const odaIUserId = params.userId as string;

  // Nickname modal state
  const [showNicknameModal, setShowNicknameModal] = useState(true);
  const [nickname, setNickname] = useState('');
  const [hasEnteredChat, setHasEnteredChat] = useState(false);

  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [participantCount, setParticipantCount] = useState(1);
  const [isConnected, setIsConnected] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second for countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCurrentTime(Date.now());
      // Remove expired messages
      setMessages(prev => prev.filter(msg => {
        if ('expires_at' in msg) {
          return new Date(msg.expires_at).getTime() > Date.now();
        }
        return true; // Keep system messages
      }));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Anti-screenshot protection
  useEffect(() => {
    const preventScreenCapture = async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch (e) {
        console.log('Screen capture prevention not supported');
      }
    };
    preventScreenCapture();
    return () => {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  // Handle entering chat with nickname
  const handleEnterChat = () => {
    if (!nickname.trim()) {
      Alert.alert('Atenção', 'Digite um apelido para entrar no chat');
      return;
    }
    setShowNicknameModal(false);
    setHasEnteredChat(true);
    connectWebSocket();
    loadMessages();
  };

  // WebSocket connection
  const connectWebSocket = () => {
    if (!hasEnteredChat && showNicknameModal) return;
    
    try {
      const wsBaseUrl = getWsUrl();
      const wsUrl = `${wsBaseUrl}/ws/${sessionId}`;
      console.log('Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
        // Send join notification
        ws.send(JSON.stringify({
          type: 'join',
          nickname: nickname,
          sender_id: odaIUserId,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'new_message') {
            const msg = data.message;
            msg.created_at = msg.created_at || new Date().toISOString();
            msg.expires_at = msg.expires_at || new Date(Date.now() + ttlMinutes * 60000).toISOString();
            
            setMessages(prev => {
              if (prev.find(m => 'id' in m && m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            
            // Vibrate on new message from others
            if (msg.sender_id !== odaIUserId) {
              Vibration.vibrate(100);
            }
          } else if (data.type === 'participant_update') {
            const oldCount = participantCount;
            setParticipantCount(data.count);
            
            // Show notification when someone joins
            if (data.count > oldCount && data.nickname) {
              addSystemMessage(`${data.nickname} entrou na conversa`);
              Vibration.vibrate([0, 100, 50, 100]);
            } else if (data.count < oldCount && data.nickname) {
              addSystemMessage(`${data.nickname} saiu da conversa`);
            }
          } else if (data.type === 'user_joined') {
            addSystemMessage(`${data.nickname || 'Alguém'} entrou na conversa`);
            Vibration.vibrate([0, 100, 50, 100]);
            setParticipantCount(prev => prev + 1);
          } else if (data.type === 'user_left') {
            addSystemMessage(`${data.nickname || 'Alguém'} saiu da conversa`);
            setParticipantCount(prev => Math.max(1, prev - 1));
          } else if (data.type === 'session_upgraded') {
            setIsPro(true);
            setTtlMinutes(30);
            addSystemMessage('🎉 Sessão atualizada para PRO! Mensagens agora duram 30 minutos.');
            Alert.alert('Upgrade realizado!', 'Suas mensagens agora duram 30 minutos!');
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('WebSocket connection error:', e);
    }
  };

  const addSystemMessage = (content: string) => {
    const sysMsg: SystemMessage = {
      id: `sys-${Date.now()}`,
      type: 'system',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, sysMsg]);
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'leave',
          nickname: nickname,
          sender_id: odaIUserId,
        }));
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  const loadMessages = async () => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (e) {
      console.error('Error loading messages:', e);
    }
  };

  // Audio setup
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
    };
  }, []);

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    const text = inputText.trim();
    setInputText('');

    try {
      const baseUrl = getApiUrl();
      await fetch(`${baseUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          content: text,
          message_type: 'text',
          sender_id: odaIUserId,
          sender_nickname: nickname,
        }),
      });
    } catch (e) {
      console.error('Error sending message:', e);
      setInputText(text);
    }
  };

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permissão necessária', 'Permita o acesso ao microfone para gravar áudios.');
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          if (prev >= 60) {
            stopRecording();
            return 60;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (e) {
      console.error('Error starting recording:', e);
      Alert.alert('Erro', 'Não foi possível iniciar a gravação');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    setIsRecording(false);
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (uri && recordingDuration > 0) {
        const response = await fetch(uri);
        const blob = await response.blob();
        const reader = new FileReader();
        
        reader.onloadend = async () => {
          const base64 = reader.result as string;
          const baseUrl = getApiUrl();
          
          try {
            await fetch(`${baseUrl}/api/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: sessionId,
                content: base64,
                message_type: 'audio',
                sender_id: odaIUserId,
                sender_nickname: nickname,
              }),
            });
          } catch (e) {
            console.error('Error sending audio:', e);
          }
        };
        
        reader.readAsDataURL(blob);
      }
    } catch (e) {
      console.error('Error stopping recording:', e);
    }
    
    setRecordingDuration(0);
  };

  const playAudio = async (audioBase64: string, messageId: string) => {
    try {
      if (soundRef.current) await soundRef.current.unloadAsync();

      if (playingAudioId === messageId) {
        setPlayingAudioId(null);
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioBase64 },
        { shouldPlay: true }
      );

      soundRef.current = sound;
      setPlayingAudioId(messageId);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingAudioId(null);
        }
      });
    } catch (e) {
      console.error('Error playing audio:', e);
      setPlayingAudioId(null);
    }
  };

  const copySessionLink = async () => {
    const baseUrl = Platform.OS === 'web' && typeof window !== 'undefined' 
      ? window.location.origin 
      : API_URL;
    const link = `${baseUrl}/?session=${sessionCode}`;
    await Clipboard.setStringAsync(link);
    Alert.alert('Link copiado!', 'Compartilhe com quem você quer conversar.');
    setShowOptions(false);
  };

  const upgradeToProHandler = async () => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.checkout_url) {
          await WebBrowser.openBrowserAsync(data.checkout_url);
        }
      } else {
        throw new Error('Failed to create checkout');
      }
    } catch (e) {
      console.error('Error upgrading:', e);
      Alert.alert('Erro', 'Não foi possível processar o upgrade. Tente novamente.');
    }
    setShowOptions(false);
  };

  const getTimeRemaining = (expiresAt: string) => {
    const now = Date.now();
    const expires = new Date(expiresAt).getTime();
    const diff = Math.max(0, Math.floor((expires - now) / 1000));
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return { minutes, seconds, total: diff, formatted: `${minutes}:${seconds.toString().padStart(2, '0')}` };
  };

  const getCountdownColor = (secondsLeft: number) => {
    if (secondsLeft <= 30) return '#ef4444'; // Red - urgent
    if (secondsLeft <= 60) return '#f59e0b'; // Orange - warning
    return '#10b981'; // Green - safe
  };

  const renderMessage = ({ item }: { item: ChatItem }) => {
    // System message
    if ('type' in item && item.type === 'system') {
      return (
        <View style={styles.systemMessage}>
          <Text style={styles.systemMessageText}>{item.content}</Text>
        </View>
      );
    }

    const msg = item as Message;
    const isOwn = msg.sender_id === odaIUserId;
    const timeInfo = getTimeRemaining(msg.expires_at);
    const countdownColor = getCountdownColor(timeInfo.total);

    return (
      <View style={[styles.messageBubble, isOwn ? styles.ownMessage : styles.otherMessage]}>
        {!isOwn && msg.sender_nickname && (
          <Text style={styles.senderName}>{msg.sender_nickname}</Text>
        )}
        
        {msg.message_type === 'audio' ? (
          <TouchableOpacity style={styles.audioButton} onPress={() => playAudio(msg.content, msg.id)}>
            <Ionicons
              name={playingAudioId === msg.id ? 'pause' : 'play'}
              size={24}
              color={isOwn ? '#000' : '#10b981'}
            />
            <View style={styles.audioWaveform}>
              {[...Array(12)].map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    { height: Math.random() * 16 + 8, backgroundColor: isOwn ? '#000' : '#10b981' }
                  ]}
                />
              ))}
            </View>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.messageText, isOwn && styles.ownMessageText]}>
            {msg.content}
          </Text>
        )}
        
        {/* Countdown timer */}
        <View style={[styles.countdownContainer, { borderColor: countdownColor }]}>
          <Ionicons name="time-outline" size={12} color={countdownColor} />
          <Text style={[styles.countdownText, { color: countdownColor }]}>
            {timeInfo.formatted}
          </Text>
          {timeInfo.total <= 30 && (
            <Ionicons name="warning" size={12} color={countdownColor} style={{ marginLeft: 4 }} />
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Nickname Modal */}
      <Modal
        visible={showNicknameModal}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.nicknameModal}>
            <Text style={styles.modalTitle}>SEU APELIDO</Text>
            <Text style={styles.modalSubtitle}>Como você quer ser chamado nesta conversa?</Text>
            
            <TextInput
              style={styles.nicknameInput}
              placeholder="Digite seu apelido..."
              placeholderTextColor="#6b7280"
              value={nickname}
              onChangeText={setNickname}
              maxLength={20}
              autoFocus
            />
            
            <TouchableOpacity style={styles.enterButton} onPress={handleEnterChat}>
              <Text style={styles.enterButtonText}>ENTRAR NO CHAT</Text>
            </TouchableOpacity>
            
            <Text style={styles.modalHint}>
              Você pode mudar seu apelido clicando no nome no topo
            </Text>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <View style={[styles.statusDot, isConnected && styles.statusDotActive]} />
            <Text style={styles.headerTitle}>#{sessionCode}</Text>
            {isPro && (
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
            )}
          </View>
          <Text style={styles.headerSubtitle}>
            {participantCount} {participantCount === 1 ? 'participante' : 'participantes'} • {ttlMinutes}min
          </Text>
        </View>

        <TouchableOpacity onPress={copySessionLink} style={styles.shareButton}>
          <Ionicons name="share-social" size={22} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowOptions(!showOptions)} style={styles.optionsButton}>
          <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Options Menu */}
      {showOptions && (
        <View style={styles.optionsMenu}>
          <TouchableOpacity style={styles.optionItem} onPress={copySessionLink}>
            <Ionicons name="link" size={20} color="#10b981" />
            <Text style={styles.optionText}>Copiar link</Text>
          </TouchableOpacity>
          {!isPro && (
            <TouchableOpacity style={styles.optionItem} onPress={upgradeToProHandler}>
              <Ionicons name="flash" size={20} color="#f59e0b" />
              <Text style={styles.optionText}>Upgrade para Pro (R$9,99)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={48} color="#333" />
            <Text style={styles.emptyText}>Nenhuma mensagem ainda</Text>
            <Text style={styles.emptySubtext}>Comece a conversar de forma segura!</Text>
          </View>
        }
      />

      {/* Input Area */}
      <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {isRecording ? (
          <View style={styles.recordingContainer}>
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Gravando... {recordingDuration}s</Text>
            </View>
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <Ionicons name="stop" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.micButton} onPress={startRecording}>
              <Ionicons name="mic" size={24} color="#10b981" />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Mensagem..."
              placeholderTextColor="#6b7280"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!inputText.trim()}
            >
              <Ionicons name="send" size={20} color={inputText.trim() ? '#000' : '#666'} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  nicknameModal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  nicknameInput: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  enterButton: {
    backgroundColor: '#10b981',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  enterButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  modalHint: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 8,
  },
  statusDotActive: {
    backgroundColor: '#10b981',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  proBadge: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#000',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  optionsButton: {
    padding: 8,
  },
  optionsMenu: {
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingVertical: 8,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 12,
  },
  optionText: {
    color: '#fff',
    fontSize: 14,
  },
  messagesList: {
    padding: 16,
    flexGrow: 1,
  },
  systemMessage: {
    alignItems: 'center',
    marginVertical: 8,
  },
  systemMessageText: {
    fontSize: 12,
    color: '#6b7280',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  ownMessage: {
    backgroundColor: '#10b981',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  otherMessage: {
    backgroundColor: '#1a1a1a',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 11,
    color: '#10b981',
    fontWeight: '600',
    marginBottom: 4,
  },
  messageText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
  },
  ownMessageText: {
    color: '#000',
  },
  countdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: 4,
  },
  countdownText: {
    fontSize: 11,
    fontWeight: '600',
  },
  audioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  audioWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
    marginTop: 16,
  },
  emptySubtext: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 8,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#1a1a1a',
  },
  recordingContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
  },
  recordingText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  stopButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
