const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3000;
const BACKEND_URL = 'http://localhost:8001';
const EXPO_URL = 'http://localhost:19006'; // Expo web server

// Proxy API requests to backend
app.use('/api', createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  logLevel: 'debug',
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error' });
  }
}));

// Proxy WebSocket connections
app.use('/ws', createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
  logLevel: 'debug'
}));

// Proxy everything else to Expo web server
app.use('/', createProxyMiddleware({
  target: EXPO_URL,
  changeOrigin: true,
  ws: true,
  logLevel: 'debug',
  onError: (err, req, res) => {
    console.error('Expo proxy error:', err);
    res.status(502).send('Expo server not ready');
  }
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`API requests -> ${BACKEND_URL}`);
  console.log(`Expo requests -> ${EXPO_URL}`);
});
