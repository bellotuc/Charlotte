import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Alert,
  AppState,
  Animated,
  Linking,
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

// Use relative URLs for web, full URLs for native
const getApiUrl = () => {
  if (Platform.OS === 'web') {
    return ''; // Use relative URLs on web
  }
  return API_URL;
};

const getWsUrl = () => {
  if (Platform.OS === 'web') {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : '';
    return `${protocol}//${host}`;
  }
  return WS_URL;
};

interface Message {
  id: string;
  session_id: string;
  content: string;
  message_type: 'text' | 'audio';
  sender_id: string;
  created_at: string;
  expires_at: string;
}

export default function ChatScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const sessionId = params.sessionId as string;
  const sessionCode = params.sessionCode as string;
  const [isPro, setIsPro] = useState(params.isPro === 'true');
  const [ttlMinutes, setTtlMinutes] = useState(parseInt(params.ttlMinutes as string) || 5);
  const userId = params.userId as string;
  const isCreator = params.isCreator === 'true';

  const [messages, setMessages] = useState<Message[]>([]);
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

  // Anti-screenshot protection
  useEffect(() => {
    const preventScreenCapture = async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch (e) {
        console.log('Screen capture prevention not supported on this platform');
      }
    };

    preventScreenCapture();

    return () => {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  // WebSocket connection
  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [sessionId]);

  const connectWebSocket = () => {
    try {
      const wsBaseUrl = getWsUrl();
      const wsUrl = `${wsBaseUrl}/ws/${sessionId}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'new_message') {
          const msg = data.message;
          msg.created_at = msg.created_at || new Date().toISOString();
          msg.expires_at = msg.expires_at || new Date(Date.now() + ttlMinutes * 60000).toISOString();
          
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        } else if (data.type === 'participant_update') {
          setParticipantCount(data.count);
        } else if (data.type === 'session_upgraded') {
          setIsPro(true);
          setTtlMinutes(30);
          Alert.alert('Upgrade realizado!', 'Agora suas mensagens duram 30 minutos!');
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3 seconds
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

  // Load initial messages
  useEffect(() => {
    loadMessages();
  }, [sessionId]);

  const loadMessages = async () => {
    try {
      const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (e) {
      console.error('Error loading messages:', e);
    }
  };

  // Message expiration timer
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setMessages(prev => prev.filter(msg => new Date(msg.expires_at) > now));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Audio setup
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
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
          sender_id: userId,
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

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

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
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (uri && recordingDuration > 0) {
        // Convert to base64 and send
        const response = await fetch(uri);
        const blob = await response.blob();
        const reader = new FileReader();
        
        reader.onloadend = async () => {
          const base64 = reader.result as string;
          
          try {
            await fetch(`${API_URL}/api/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: sessionId,
                content: base64,
                message_type: 'audio',
                sender_id: userId,
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
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

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
    const link = `${API_URL}/?session=${sessionCode}`;
    await Clipboard.setStringAsync(link);
    Alert.alert('Link copiado!', 'Compartilhe com quem você quer conversar.');
  };

  const upgradeToProHandler = async () => {
    try {
      const response = await fetch(`${API_URL}/api/sessions/${sessionId}/upgrade`, {
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
  };

  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwn = item.sender_id === userId;
    const timeRemaining = getTimeRemaining(item.expires_at);

    return (
      <View style={[styles.messageBubble, isOwn ? styles.ownMessage : styles.otherMessage]}>
        {item.message_type === 'audio' ? (
          <TouchableOpacity
            style={styles.audioButton}
            onPress={() => playAudio(item.content, item.id)}
          >
            <Ionicons
              name={playingAudioId === item.id ? 'pause' : 'play'}
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
            {item.content}
          </Text>
        )}
        <View style={styles.messageFooter}>
          <Ionicons name="time-outline" size={10} color={isOwn ? 'rgba(0,0,0,0.5)' : '#6b7280'} />
          <Text style={[styles.timerText, isOwn && styles.ownTimerText]}>{timeRemaining}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
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
            {participantCount} {participantCount === 1 ? 'participante' : 'participantes'} • {ttlMinutes}min TTL
          </Text>
        </View>

        <TouchableOpacity onPress={() => setShowOptions(!showOptions)} style={styles.optionsButton}>
          <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Options Menu */}
      {showOptions && (
        <View style={styles.optionsMenu}>
          <TouchableOpacity style={styles.optionItem} onPress={copySessionLink}>
            <Ionicons name="share-outline" size={20} color="#10b981" />
            <Text style={styles.optionText}>Compartilhar link</Text>
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
              <Text style={styles.recordingText}>
                Gravando... {recordingDuration}s
              </Text>
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
              placeholder="Digite sua mensagem..."
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
  messageText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
  },
  ownMessageText: {
    color: '#000',
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  timerText: {
    fontSize: 10,
    color: '#6b7280',
  },
  ownTimerText: {
    color: 'rgba(0,0,0,0.5)',
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
