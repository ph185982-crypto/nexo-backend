require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const generateRouter = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS — allow frontend origin
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-openai-key'],
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ShopeeBoost AI Backend' });
});

// Routes
app.use('/api', generateRouter);

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  res.status(500).json({ error: 'Erro interno do servidor. Tente novamente.' });
});

app.listen(PORT, () => {
  console.log(`ShopeeBoost AI Backend rodando na porta ${PORT}`);
});
