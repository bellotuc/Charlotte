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
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
import * as ScreenCapture from 'expo-screen-capture';
import * as WebBrowser from 'expo-web-browser';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const WS_URL = process.env.EXPO_PUBLIC_WS_URL || '';

const getApiUrl = () => API_URL;
const getWsUrl = () => WS_URL.replace('https', 'wss').replace('http', 'ws');

interface Message {
  id: string;
  session_id: string;
  content: string;
  message_type: 'text' | 'audio' | 'image' | 'video' | 'document';
  file_name?: string;
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
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const sessionId = params.sessionId as string;
  const sessionCode = params.sessionCode as string;
  const [isPro, setIsPro] = useState(params.isPro === 'true');
  const [ttlMinutes, setTtlMinutes] = useState(parseInt(params.ttlMinutes as string) || 10);
  const [maxParticipants, setMaxParticipants] = useState(isPro ? 50 : 5);
  const odaIUserId = params.userId as string;
  const isCreator = params.isCreator === 'true'; // Host who created the session

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
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Typing indicator
  const [typingUsers, setTypingUsers] = useState<{[key: string]: string}>({});
  const [isTyping, setIsTyping] = useState(false);

  // Update current time every second for countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCurrentTime(Date.now());
      setMessages(prev => prev.filter(msg => {
        if ('expires_at' in msg) {
          return new Date(msg.expires_at).getTime() > Date.now();
        }
        return true;
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

  // Handle typing indicator
  const handleInputChange = (text: string) => {
    setInputText(text);
    
    if (!isTyping && text.length > 0) {
      setIsTyping(true);
      sendTypingIndicator(true);
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      sendTypingIndicator(false);
    }, 2000);
  };

  const sendTypingIndicator = (typing: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'typing',
        sender_id: odaIUserId,
        nickname: nickname,
        is_typing: typing,
      }));
    }
  };

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
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        ws.send(JSON.stringify({
          type: 'join',
          nickname: nickname,
          sender_id: odaIUserId,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle session full error
          if (data.type === 'error' && data.code === 'SESSION_FULL') {
            Alert.alert(
              'Sessão Lotada',
              data.message || `Máximo de ${data.max_participants} participantes atingido.`,
              [{ text: 'Voltar', onPress: () => router.back() }]
            );
            return;
          }
          
          if (data.type === 'new_message') {
            const msg = data.message;
            msg.created_at = msg.created_at || new Date().toISOString();
            msg.expires_at = msg.expires_at || new Date(Date.now() + ttlMinutes * 60000).toISOString();
            
            setMessages(prev => {
              if (prev.find(m => 'id' in m && m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            
            if (msg.sender_id !== odaIUserId) {
              Vibration.vibrate(100);
            }
          } else if (data.type === 'user_joined') {
            addSystemMessage(`🟢 ${data.nickname || 'Alguém'} entrou na conversa`);
            Vibration.vibrate([0, 100, 50, 100]);
            if (data.count) setParticipantCount(data.count);
            if (data.max_participants) setMaxParticipants(data.max_participants);
          } else if (data.type === 'user_left') {
            addSystemMessage(`🔴 ${data.nickname || 'Alguém'} saiu da conversa`);
            if (data.count) setParticipantCount(data.count);
          } else if (data.type === 'typing') {
            if (data.sender_id !== odaIUserId) {
              if (data.is_typing) {
                setTypingUsers(prev => ({...prev, [data.sender_id]: data.nickname || 'Alguém'}));
              } else {
                setTypingUsers(prev => {
                  const newState = {...prev};
                  delete newState[data.sender_id];
                  return newState;
                });
              }
            }
          } else if (data.type === 'session_upgraded') {
            setIsPro(true);
            setTtlMinutes(60);
            setMaxParticipants(50);
            addSystemMessage('🎉 Sessão PRO! 60 minutos e até 50 participantes.');
            Alert.alert('Upgrade realizado!', 'Mensagens duram 60 minutos e até 50 participantes!');
          } else if (data.type === 'participant_update') {
            setParticipantCount(data.count);
          } else if (data.type === 'session_destroyed') {
            Alert.alert(
              '💥 Sessão Encerrada',
              data.message || 'A sessão foi destruída pelo anfitrião.',
              [{ text: 'OK', onPress: () => router.replace('/') }]
            );
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
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
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

  const sendMessage = async (content: string, messageType: string = 'text', fileName?: string) => {
    try {
      const baseUrl = getApiUrl();
      await fetch(`${baseUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          content: content,
          message_type: messageType,
          file_name: fileName,
          sender_id: odaIUserId,
          sender_nickname: nickname,
        }),
      });
    } catch (e) {
      console.error('Error sending message:', e);
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    setIsTyping(false);
    sendTypingIndicator(false);
    await sendMessage(text, 'text');
  };

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permissão necessária', 'Permita o acesso ao microfone.');
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
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const dataUri = `data:audio/m4a;base64,${base64}`;
        await sendMessage(dataUri, 'audio');
      }
    } catch (e) {
      console.error('Error stopping recording:', e);
    }
    
    setRecordingDuration(0);
  };

  // PRO Features - Camera
  const takePhoto = async () => {
    if (!isPro) {
      Alert.alert('Recurso Pro', 'Faça upgrade para enviar fotos e vídeos.');
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permissão necessária', 'Permita o acesso à câmera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      const dataUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
      await sendMessage(dataUri, 'image');
    }
    setShowAttachMenu(false);
  };

  const takeVideo = async () => {
    if (!isPro) {
      Alert.alert('Recurso Pro', 'Faça upgrade para enviar fotos e vídeos.');
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permissão necessária', 'Permita o acesso à câmera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 30,
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0].uri) {
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, { 
        encoding: FileSystem.EncodingType.Base64 
      });
      const dataUri = `data:video/mp4;base64,${base64}`;
      await sendMessage(dataUri, 'video');
    }
    setShowAttachMenu(false);
  };

  const pickDocument = async () => {
    if (!isPro) {
      Alert.alert('Recurso Pro', 'Faça upgrade para enviar documentos.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const file = result.assets[0];
        const base64 = await FileSystem.readAsStringAsync(file.uri, { 
          encoding: FileSystem.EncodingType.Base64 
        });
        const mimeType = file.mimeType || 'application/octet-stream';
        const dataUri = `data:${mimeType};base64,${base64}`;
        await sendMessage(dataUri, 'document', file.name);
      }
    } catch (e) {
      console.error('Error picking document:', e);
    }
    setShowAttachMenu(false);
  };

  // Auto-destruct session (only for host/creator)
  const destroySession = async () => {
    Alert.alert(
      '💥 Auto-Destruição',
      'Tem certeza? Isso vai apagar TODAS as mensagens e encerrar a conversa para todos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'DESTRUIR',
          style: 'destructive',
          onPress: async () => {
            try {
              const baseUrl = getApiUrl();
              const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/destroy`, {
                method: 'DELETE',
              });
              
              if (response.ok) {
                router.replace('/');
              } else {
                Alert.alert('Erro', 'Não foi possível destruir a sessão.');
              }
            } catch (e) {
              console.error('Error destroying session:', e);
              Alert.alert('Erro', 'Falha ao destruir sessão.');
            }
          }
        }
      ]
    );
    setShowOptions(false);
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
      }
    } catch (e) {
      console.error('Error upgrading:', e);
      Alert.alert('Erro', 'Não foi possível processar o upgrade.');
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
    if (secondsLeft <= 30) return '#ef4444';
    if (secondsLeft <= 60) return '#f59e0b';
    return '#10b981';
  };

  const typingText = Object.values(typingUsers).length > 0 
    ? `${Object.values(typingUsers).join(', ')} digitando...` 
    : null;

  const renderMessage = ({ item }: { item: ChatItem }) => {
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

    const renderContent = () => {
      switch (msg.message_type) {
        case 'audio':
          return (
            <TouchableOpacity style={styles.audioButton} onPress={() => playAudio(msg.content, msg.id)}>
              <Ionicons name={playingAudioId === msg.id ? 'pause' : 'play'} size={24} color={isOwn ? '#000' : '#10b981'} />
              <View style={styles.audioWaveform}>
                {[...Array(12)].map((_, i) => (
                  <View key={i} style={[styles.waveBar, { height: Math.random() * 16 + 8, backgroundColor: isOwn ? '#000' : '#10b981' }]} />
                ))}
              </View>
            </TouchableOpacity>
          );
        case 'image':
          return (
            <Image source={{ uri: msg.content }} style={styles.messageImage} resizeMode="cover" />
          );
        case 'video':
          return (
            <View style={styles.videoContainer}>
              <Ionicons name="videocam" size={40} color={isOwn ? '#000' : '#10b981'} />
              <Text style={[styles.videoText, isOwn && { color: '#000' }]}>Vídeo</Text>
            </View>
          );
        case 'document':
          return (
            <View style={styles.documentContainer}>
              <Ionicons name="document" size={32} color={isOwn ? '#000' : '#10b981'} />
              <Text style={[styles.documentText, isOwn && { color: '#000' }]} numberOfLines={2}>
                {msg.file_name || 'Documento'}
              </Text>
            </View>
          );
        default:
          return <Text style={[styles.messageText, isOwn && styles.ownMessageText]}>{msg.content}</Text>;
      }
    };

    return (
      <View style={[styles.messageBubble, isOwn ? styles.ownMessage : styles.otherMessage]}>
        {!isOwn && msg.sender_nickname && (
          <Text style={styles.senderName}>{msg.sender_nickname}</Text>
        )}
        {renderContent()}
        <View style={[styles.countdownContainer, { borderColor: countdownColor }]}>
          <Ionicons name="time-outline" size={12} color={countdownColor} />
          <Text style={[styles.countdownText, { color: countdownColor }]}>{timeInfo.formatted}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Nickname Modal */}
      <Modal visible={showNicknameModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.nicknameModal}>
            <Text style={styles.modalTitle}>SEU APELIDO</Text>
            <Text style={styles.modalSubtitle}>Como você quer ser chamado?</Text>
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
            {isPro && <View style={styles.proBadge}><Text style={styles.proBadgeText}>PRO</Text></View>}
          </View>
          <Text style={styles.headerSubtitle}>
            {participantCount}/{maxParticipants} pessoas • {ttlMinutes}min
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

      {/* Typing Indicator */}
      {typingText && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>{typingText}</Text>
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
          </View>
        }
      />

      {/* Attach Menu */}
      {showAttachMenu && (
        <View style={styles.attachMenu}>
          <TouchableOpacity style={styles.attachOption} onPress={takePhoto}>
            <View style={[styles.attachIcon, { backgroundColor: isPro ? '#10b981' : '#4b5563' }]}>
              <Ionicons name="camera" size={24} color="#fff" />
            </View>
            <Text style={styles.attachText}>Foto</Text>
            {!isPro && <Text style={styles.proLabel}>PRO</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachOption} onPress={takeVideo}>
            <View style={[styles.attachIcon, { backgroundColor: isPro ? '#8b5cf6' : '#4b5563' }]}>
              <Ionicons name="videocam" size={24} color="#fff" />
            </View>
            <Text style={styles.attachText}>Vídeo</Text>
            {!isPro && <Text style={styles.proLabel}>PRO</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachOption} onPress={pickDocument}>
            <View style={[styles.attachIcon, { backgroundColor: isPro ? '#f59e0b' : '#4b5563' }]}>
              <Ionicons name="document" size={24} color="#fff" />
            </View>
            <Text style={styles.attachText}>Documento</Text>
            {!isPro && <Text style={styles.proLabel}>PRO</Text>}
          </TouchableOpacity>
        </View>
      )}

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
            <TouchableOpacity style={styles.attachButton} onPress={() => setShowAttachMenu(!showAttachMenu)}>
              <Ionicons name="add-circle" size={28} color={isPro ? '#10b981' : '#6b7280'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.micButton} onPress={startRecording}>
              <Ionicons name="mic" size={24} color="#10b981" />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Mensagem..."
              placeholderTextColor="#6b7280"
              value={inputText}
              onChangeText={handleInputChange}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
              onPress={handleSendText}
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  nicknameModal: { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, borderWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 8 },
  modalSubtitle: { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 24 },
  nicknameInput: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, fontSize: 16, color: '#fff', textAlign: 'center', marginBottom: 16 },
  enterButton: { backgroundColor: '#10b981', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  enterButtonText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  backButton: { padding: 8 },
  headerCenter: { flex: 1, marginLeft: 8 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 8 },
  statusDotActive: { backgroundColor: '#10b981' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: 1 },
  proBadge: { backgroundColor: '#f59e0b', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  proBadgeText: { fontSize: 10, fontWeight: '800', color: '#000' },
  headerSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  shareButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  optionsButton: { padding: 8 },
  optionsMenu: { backgroundColor: '#1a1a1a', borderBottomWidth: 1, borderBottomColor: '#333', paddingVertical: 8 },
  optionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, gap: 12 },
  optionText: { color: '#fff', fontSize: 14 },
  typingIndicator: { backgroundColor: '#1a1a1a', paddingVertical: 8, paddingHorizontal: 16 },
  typingText: { color: '#10b981', fontSize: 13, fontStyle: 'italic' },
  messagesList: { padding: 16, flexGrow: 1 },
  systemMessage: { alignItems: 'center', marginVertical: 8 },
  systemMessageText: { fontSize: 12, color: '#6b7280', backgroundColor: '#1a1a1a', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  ownMessage: { backgroundColor: '#10b981', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  otherMessage: { backgroundColor: '#1a1a1a', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, color: '#10b981', fontWeight: '600', marginBottom: 4 },
  messageText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  ownMessageText: { color: '#000' },
  countdownContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 4 },
  countdownText: { fontSize: 11, fontWeight: '600' },
  audioButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  audioWaveform: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { width: 3, borderRadius: 2 },
  messageImage: { width: 200, height: 150, borderRadius: 8 },
  videoContainer: { alignItems: 'center', padding: 16 },
  videoText: { color: '#fff', marginTop: 8, fontSize: 12 },
  documentContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  documentText: { color: '#fff', fontSize: 13, flex: 1 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  emptyText: { color: '#6b7280', fontSize: 16, marginTop: 16 },
  attachMenu: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#1a1a1a', paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#333' },
  attachOption: { alignItems: 'center' },
  attachIcon: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  attachText: { color: '#fff', fontSize: 12 },
  proLabel: { color: '#f59e0b', fontSize: 10, fontWeight: '700', marginTop: 2 },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  attachButton: { padding: 8 },
  micButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  textInput: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 8, color: '#fff', fontSize: 15, maxHeight: 100 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#1a1a1a' },
  recordingContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ef4444' },
  recordingText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
  stopButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center' },
});
