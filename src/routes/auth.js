import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Business, User } from '../models/index.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { serializeUser } from '../utils/serializers.js';

const router = Router();

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

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciales incorrectas.' });
    }

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
      user: serializeUser(user),
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

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const business = req.user.business
      ? await Business.findById(req.user.business).lean()
      : null;
    res.json({
      user: serializeUser(req.user),
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

export default router;
