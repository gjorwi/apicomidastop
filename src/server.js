import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import { Coupon, CouponPurchase, User, Visit } from './models/index.js';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/client.js';
import publicRoutes from './routes/public.js';
import businessRoutes from './routes/business.js';
import adminRoutes from './routes/admin.js';

const app = express();
const port = Number(process.env.PORT || 4000);

const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.BUSINESS_ORIGIN,
  process.env.ADMIN_ORIGIN,
]
  .filter(Boolean)
  .flatMap((value) => value.split(','))
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origen no permitido por CORS.'));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
});

app.get('/api/health', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const databaseStatus = states[mongoose.connection.readyState] || 'unknown';
  const ok = databaseStatus === 'connected';

  res.status(ok ? 200 : 503).json({
    ok,
    service: 'dondecomo-api',
    database: {
      status: databaseStatus,
      name: mongoose.connection.name || null,
    },
  });
});

app.use('/api/auth', writeLimiter, authRoutes);
app.use('/api/ratings', writeLimiter);
app.use('/api/businesses/:slug/scan', writeLimiter);
app.use('/api/business-requests', writeLimiter);
app.use('/api/client', clientRoutes);
app.use('/api', publicRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada.' });
});

app.use((error, _req, res, _next) => {
  if (error?.code === 11000) {
    return res.status(409).json({
      message: 'Ya existe un registro con esos datos.',
    });
  }
  console.error(error);
  return res.status(error.status || 500).json({
    message: error.message || 'Error interno del servidor.',
  });
});

async function start() {
  await connectDB();

  // El índice único sparse de Google no admite varios documentos con
  // googleId: null. Los usuarios sin Google deben tener el campo ausente.
  await User.updateMany(
    { googleId: null },
    { $unset: { googleId: '' } },
  ).catch((error) => {
    console.error('No se pudo limpiar googleId nulo:', error.message);
  });

  const expireVisits = () =>
    Visit.updateMany(
      { status: 'active', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired' } },
    ).catch((error) => {
      console.error('No se pudieron expirar las visitas:', error.message);
    });

  const expireCoupons = async () => {
    const now = new Date();
    await Promise.all([
      CouponPurchase.updateMany(
        { status: 'acquired', expiresAt: { $lte: now } },
        { $set: { status: 'expired' } },
      ),
      Coupon.updateMany(
        {
          status: 'active',
          availableUntil: { $ne: null, $lte: now },
        },
        { $set: { status: 'ended' } },
      ),
    ]);
  };

  await Promise.all([expireVisits(), expireCoupons()]);
  const expiryTimer = setInterval(() => {
    expireVisits();
    expireCoupons().catch((error) => {
      console.error('No se pudieron expirar los cupones:', error.message);
    });
  }, 5 * 60 * 1000);
  expiryTimer.unref?.();

  app.listen(port, () => {
    console.log(`API dóndecomo escuchando en http://localhost:${port}/api`);
  });
}

start().catch((error) => {
  console.error('No se pudo iniciar la API:', error.message);
  process.exit(1);
});
