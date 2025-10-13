const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
__path = process.cwd();
const PORT = process.env.PAIR_PORT || 3001;

// Only include existing routes
let pairRoute = require('./routers/pair');
require('events').EventEmitter.defaultMaxListeners = 1500;

// Configure CORS
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Removed: qr and validate routes
app.use('/code', pairRoute);

app.get('/validate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'validate.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Optional: session debugging endpoint
app.get('/api/sessions', (req, res) => {
  const { getSessionStorage } = require('./lib');
  const sessionStorage = getSessionStorage();
  const sessions = Array.from(sessionStorage.keys());
  res.json({
    total: sessions.length,
    sessions: sessions.map(id => ({
      id,
      createdAt: sessionStorage.get(id)?.createdAt
    }))
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'Something went wrong',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
Deployment Successful!

TREKKER-MD-Session-Server Running on http://0.0.0.0:${PORT}
`);
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
