import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const { width } = Dimensions.get('window');

// Always use full URL for API calls
const getApiUrl = () => {
  return API_URL;
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateUserId = async () => {
    const uuid = await Crypto.randomUUID();
    return uuid.slice(0, 8);
  };

  const createSession = async () => {
    setLoading(true);
    setError('');
    try {
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) throw new Error('Failed to create session');

      const session = await response.json();
      const userId = await generateUserId();
      
      // Copy link to clipboard - use window.location.origin on web
      const shareBaseUrl = Platform.OS === 'web' && typeof window !== 'undefined' 
        ? window.location.origin 
        : API_URL;
      const shareLink = `${shareBaseUrl}/?session=${session.code}`;
      await Clipboard.setStringAsync(shareLink);

      router.push({
        pathname: '/chat',
        params: {
          sessionId: session.id,
          sessionCode: session.code,
          isPro: session.is_pro ? 'true' : 'false',
          ttlMinutes: session.message_ttl_minutes.toString(),
          userId,
          isCreator: 'true',
        },
      });
    } catch (err) {
      setError('Erro ao criar sessão. Tente novamente.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>Protocolo de Privacidade Máxima</Text>
          <Text style={styles.titleAccent}>CHARLOTTE</Text>
          <Text style={styles.subtitle}>
            Conversas que desaparecem. Sem capturas de tela. Sem rastros.
          </Text>
        </View>

        {/* Timer Badge */}
        <View style={styles.timerBadge}>
          <Ionicons name="time-outline" size={16} color="#10b981" />
          <Text style={styles.timerText}>
            10 minutos grátis. 60 minutos no modo Pro.
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={createSession}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Ionicons name="add-circle" size={24} color="#000" />
                <Text style={styles.primaryButtonText}>CRIAR SESSÃO GRÁTIS</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.copyHint}>
            <Ionicons name="copy-outline" size={14} color="#6b7280" />
            {'  '}Link copiado automaticamente
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Features */}
        <View style={styles.features}>
          <FeatureCard
            icon="shield-checkmark"
            title="Anti-Screenshot"
            description="Proteção avançada contra capturas de tela e fotografia externa."
          />
          <FeatureCard
            icon="mic"
            title="Mensagens de Áudio"
            description="Grave e envie áudios de até 1 minuto com qualidade cristalina."
          />
          <FeatureCard
            icon="timer"
            title="Auto-Destrutivo"
            description="Mensagens desaparecem após 10 minutos (Free) ou 60 minutos (Pro)."
          />
          <FeatureCard
            icon="eye-off"
            title="100% Anônimo"
            description="Sem cadastro. Sem login. Sem rastreamento."
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FeatureCard({ icon, title, description }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.featureCard}>
      <Ionicons name={icon} size={28} color="#10b981" style={styles.featureIcon} />
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDescription}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  badge: {
    fontSize: 11,
    color: '#10b981',
    letterSpacing: 2,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  titleAccent: {
    fontSize: 42,
    fontWeight: '900',
    color: '#10b981',
    letterSpacing: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 22,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 32,
  },
  timerText: {
    color: '#10b981',
    fontSize: 12,
    marginLeft: 8,
  },
  actions: {
    alignItems: 'center',
    marginBottom: 40,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    maxWidth: 320,
    gap: 10,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  copyHint: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 12,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10b981',
    marginTop: 16,
    width: '100%',
    maxWidth: 320,
    gap: 8,
  },
  secondaryButtonText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  joinContainer: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  codeInput: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: 8,
    width: '100%',
  },
  joinActions: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  joinButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#10b981',
    alignItems: 'center',
  },
  joinButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  featureCard: {
    width: (width - 64) / 2,
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  featureIcon: {
    marginBottom: 12,
  },
  featureTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  featureDescription: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
});
