import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { Business, User } from '../models/index.js';
import { requireAuth, requireRole, signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { serializeUser } from '../utils/serializers.js';

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Correo y contraseña son obligatorios.' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: 'Credenciales incorrectas.' });
    }
    if (!user.passwordHash) {
      return res.status(401).json({
        message: 'Esta cuenta usa inicio de sesión con Google.',
      });
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciales incorrectas.' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    let business = null;
    if (user.role === 'business') {
      business = await Business.findById(user.business).lean();
      if (!business || business.status !== 'approved') {
        return res.status(403).json({
          message: 'El negocio aún no tiene acceso aprobado.',
        });
      }
    }

    return res.json({
      token: signToken(user),
      user: { ...serializeUser(user), favorites: user.favorites || [] },
      business: business
        ? {
            id: business.slug,
            name: business.name,
            status: business.status,
            premiumPlan: business.premiumPlan,
          }
        : null,
    });
  }),
);

router.post(
  '/google',
  asyncHandler(async (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({
        message: 'El inicio de sesión con Google aún no está configurado.',
      });
    }

    const credential = String(req.body?.credential || '');
    if (!credential) {
      return res.status(400).json({ message: 'Falta el token de Google.' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({
        message: 'No pudimos validar tu cuenta de Google. Intenta de nuevo.',
      });
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({
        message: 'La cuenta de Google no tiene un correo verificado.',
      });
    }

    const email = payload.email.toLowerCase().trim();
    const [userByGoogle, userByEmail] = await Promise.all([
      User.findOne({ googleId: payload.sub }),
      User.findOne({ email }),
    ]);

    if (
      userByGoogle &&
      userByEmail &&
      String(userByGoogle._id) !== String(userByEmail._id)
    ) {
      return res.status(409).json({
        message: 'Ese correo ya está asociado a otra cuenta.',
      });
    }

    let user = userByGoogle || userByEmail;

    if (user) {
      if (user.role !== 'client') {
        return res.status(409).json({
          message:
            'Ese correo pertenece a una cuenta de administración o negocio. Inicia sesión con tu método habitual.',
        });
      }
      if (user.status !== 'active') {
        return res.status(403).json({
          message: 'Tu cuenta no está activa. Contacta al administrador.',
        });
      }

      user.googleId = payload.sub;
      user.email = email;
      user.avatar = payload.picture || user.avatar;
      user.authProvider = 'google';
      if (payload.name) user.name = payload.name;
      user.lastLoginAt = new Date();
      await user.save();
    } else {
      user = await User.create({
        name: payload.name || email.split('@')[0],
        email,
        googleId: payload.sub,
        avatar: payload.picture || '',
        authProvider: 'google',
        role: 'client',
        status: 'active',
        lastLoginAt: new Date(),
      });
    }

    return res.json({
      token: signToken(user),
      user: { ...serializeUser(user), favorites: user.favorites || [] },
      business: null,
    });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const business = req.user.business
      ? await Business.findById(req.user.business).lean()
      : null;
    res.json({
      user: { ...serializeUser(req.user), favorites: req.user.favorites || [] },
      business: business
        ? {
            id: business.slug,
            name: business.name,
            status: business.status,
            premiumPlan: business.premiumPlan,
          }
        : null,
    });
  }),
);

router.put(
  '/me/favorites',
  requireAuth,
  requireRole('client'),
  asyncHandler(async (req, res) => {
    const input = Array.isArray(req.body?.favorites) ? req.body.favorites : null;
    if (!input) {
      return res.status(400).json({ message: 'La lista de favoritos no es válida.' });
    }
    if (
      input.some(
        (item) => typeof item !== 'string' || item.length > 140,
      )
    ) {
      return res.status(400).json({ message: 'Hay un favorito no válido.' });
    }

    const favorites = [
      ...new Set(
        input.map((item) => item.trim()).filter(Boolean),
      ),
    ].slice(0, 300);

    req.user.favorites = favorites;
    await req.user.save();
    return res.json({ favorites });
  }),
);

export default router;
