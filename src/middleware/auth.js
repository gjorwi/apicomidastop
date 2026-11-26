import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'Debes iniciar sesión.' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: 'Sesión no válida.' });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: 'Sesión no válida o expirada.' });
  }
}

export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (user && user.status === 'active') req.user = user;
  } catch {
    // La petición sigue como invitado.
  }
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tienes permisos para esta acción.' });
    }
    return next();
  };
}

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}
