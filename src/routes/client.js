import { Router } from 'express';
import {
  Business,
  Coupon,
  CouponPurchase,
  PointTransaction,
  User,
  Visit,
} from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { distanceInMeters, isValidCoordinates } from '../utils/geo.js';
import {
  evaluateAchievements,
  getAchievementsForUser,
  getPointsSummary,
} from '../utils/loyalty.js';
import { getPlatformSettings } from '../utils/settings.js';

const router = Router();

router.use(requireAuth, requireRole('client'));

// Cierra la votación pendiente sin borrar la visita: la visita sigue activa
// para evitar que se pueda volver a escanear el mismo local durante 24 h.
router.post(
  '/me/visits/:visitId/finish',
  asyncHandler(async (req, res) => {
    const visitId = String(req.params.visitId || '');
    if (!/^[a-f\d]{24}$/i.test(visitId)) {
      return res.status(400).json({ message: 'Visita no válida.' });
    }

    const deviceId = String(req.body?.deviceId || '').trim().slice(0, 120);
    const filters = [{ user: req.user._id }];
    if (deviceId) filters.push({ deviceId });

    const visit = await Visit.findOne({
      _id: visitId,
      $or: filters,
    });
    if (!visit) {
      return res.status(404).json({
        message: 'No encontramos esa votación pendiente.',
      });
    }

    if (!visit.closedAt) {
      visit.closedAt = new Date();
      await visit.save();
    }

    return res.json({
      ok: true,
      status: visit.status,
      closedAt: visit.closedAt,
    });
  }),
);

function serializeCoupon(coupon, business, extra = {}) {
  return {
    id: String(coupon._id),
    title: coupon.title,
    description: coupon.description,
    emoji: coupon.emoji || '🎁',
    pointsCost: coupon.pointsCost,
    stock: coupon.stock,
    perUserLimit: coupon.perUserLimit,
    validityDays: coupon.validityDays,
    availableFrom: coupon.availableFrom,
    availableUntil: coupon.availableUntil,
    status: coupon.status,
    business: {
      id: business.slug,
      name: business.name,
      category: business.categoryKey,
      address: business.address,
    },
    ...extra,
  };
}

function serializePurchase(purchase, business) {
  return {
    id: String(purchase._id),
    status: purchase.status,
    pointsSpent: purchase.pointsSpent,
    acquiredAt: purchase.acquiredAt,
    activatedAt: purchase.activatedAt,
    acceptedAt: purchase.acceptedAt,
    rejectedAt: purchase.rejectedAt,
    expiresAt: purchase.expiresAt,
    activationDistanceMeters:
      purchase.activationLocation?.distanceMeters ?? null,
    coupon: {
      title: purchase.snapshot?.title || '',
      description: purchase.snapshot?.description || '',
      emoji: purchase.snapshot?.emoji || '🎁',
      validityDays: purchase.snapshot?.validityDays || 0,
    },
    business: {
      id: business?.slug || '',
      name: business?.name || 'Negocio',
      address: business?.address || '',
    },
  };
}

router.get(
  '/coupons',
  asyncHandler(async (req, res) => {
    const { q, category, business, maxPoints, sort } = req.query;
    const now = new Date();
    const normalizedQuery = String(q || '').trim().toLowerCase();

    const businesses = await Business.find({
      status: 'approved',
      ...(business ? { slug: String(business) } : {}),
      ...(category ? { categoryKey: String(category) } : {}),
    }).lean();
    const businessMap = new Map(
      businesses.map((item) => [String(item._id), item]),
    );
    if (!businesses.length) {
      return res.json({ coupons: [], points: req.user.points || 0 });
    }

    const filter = {
      business: { $in: businesses.map((item) => item._id) },
      status: 'active',
      stock: { $gt: 0 },
      $and: [
        {
          $or: [
            { availableFrom: null },
            { availableFrom: { $lte: now } },
          ],
        },
        {
          $or: [
            { availableUntil: null },
            { availableUntil: { $gte: now } },
          ],
        },
      ],
    };
    if (maxPoints !== undefined && maxPoints !== '') {
      const value = Number(maxPoints);
      if (Number.isFinite(value) && value >= 0) {
        filter.pointsCost = { $lte: value };
      }
    }

    const [coupons, purchases] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).lean(),
      CouponPurchase.find({ user: req.user._id })
        .select('coupon')
        .lean(),
    ]);
    const purchaseCount = new Map();
    for (const purchase of purchases) {
      const key = String(purchase.coupon);
      purchaseCount.set(key, (purchaseCount.get(key) || 0) + 1);
    }

    const items = coupons
      .map((coupon) => {
        const businessItem = businessMap.get(String(coupon.business));
        if (!businessItem) return null;
        if (
          normalizedQuery &&
          !`${coupon.title} ${coupon.description} ${businessItem.name}`
            .toLowerCase()
            .includes(normalizedQuery)
        ) {
          return null;
        }
        const purchasedByUser = purchaseCount.get(String(coupon._id)) || 0;
        return serializeCoupon(coupon, businessItem, {
          purchasedByUser,
          canAcquire:
            purchasedByUser < coupon.perUserLimit &&
            (req.user.points || 0) >= coupon.pointsCost,
        });
      })
      .filter(Boolean);

    if (sort === 'points_asc') {
      items.sort((a, b) => a.pointsCost - b.pointsCost);
    } else if (sort === 'points_desc') {
      items.sort((a, b) => b.pointsCost - a.pointsCost);
    }

    return res.json({ coupons: items, points: req.user.points || 0 });
  }),
);

router.post(
  '/coupons/:id/acquire',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon || coupon.status !== 'active') {
      return res.status(404).json({ message: 'Cupón no disponible.' });
    }
    if (coupon.stock <= 0) {
      return res.status(409).json({ message: 'Este cupón ya no tiene stock.' });
    }
    if (coupon.availableFrom && coupon.availableFrom > now) {
      return res.status(409).json({ message: 'Este cupón aún no está disponible.' });
    }
    if (coupon.availableUntil && coupon.availableUntil < now) {
      return res.status(409).json({ message: 'Este cupón ya venció.' });
    }

    const business = await Business.findOne({
      _id: coupon.business,
      status: 'approved',
    }).lean();
    if (!business) {
      return res.status(404).json({ message: 'Negocio no disponible.' });
    }

    const purchased = await CouponPurchase.countDocuments({
      coupon: coupon._id,
      user: req.user._id,
    });
    if (purchased >= coupon.perUserLimit) {
      return res.status(409).json({
        message: 'Ya alcanzaste el límite de este cupón para tu cuenta.',
      });
    }
    if ((req.user.points || 0) < coupon.pointsCost) {
      return res.status(400).json({ message: 'No tienes puntos suficientes.' });
    }

    const reservedCoupon = await Coupon.findOneAndUpdate(
      { _id: coupon._id, status: 'active', stock: { $gt: 0 } },
      { $inc: { stock: -1 } },
      { new: true },
    );
    if (!reservedCoupon) {
      return res.status(409).json({ message: 'Este cupón ya no tiene stock.' });
    }

    const chargedUser = await User.findOneAndUpdate(
      { _id: req.user._id, points: { $gte: coupon.pointsCost } },
      { $inc: { points: -coupon.pointsCost } },
      { new: true },
    );
    if (!chargedUser) {
      await Coupon.updateOne(
        { _id: coupon._id },
        { $inc: { stock: 1 } },
      );
      return res.status(400).json({ message: 'No tienes puntos suficientes.' });
    }

    let purchase;
    try {
      const expiresAt = new Date(
        now.getTime() + coupon.validityDays * 24 * 60 * 60 * 1000,
      );
      purchase = await CouponPurchase.create({
        coupon: coupon._id,
        business: coupon.business,
        user: req.user._id,
        pointsSpent: coupon.pointsCost,
        status: 'acquired',
        acquiredAt: now,
        expiresAt,
        snapshot: {
          title: coupon.title,
          description: coupon.description,
          emoji: coupon.emoji,
          validityDays: coupon.validityDays,
        },
      });

      await PointTransaction.create({
        user: req.user._id,
        business: coupon.business,
        purchase: purchase._id,
        type: 'coupon_acquire',
        amount: -coupon.pointsCost,
        description: `Cupón adquirido: ${coupon.title}`,
      });
    } catch (error) {
      await Promise.all([
        Coupon.updateOne({ _id: coupon._id }, { $inc: { stock: 1 } }),
        User.updateOne(
          { _id: req.user._id },
          { $inc: { points: coupon.pointsCost } },
        ),
      ]);
      throw error;
    }

    const achievementsUnlocked = await evaluateAchievements(req.user._id);
    const updatedUser = await User.findById(req.user._id)
      .select('points')
      .lean();

    return res.status(201).json({
      purchase: serializePurchase(purchase, business),
      pointsBalance: updatedUser?.points || 0,
      achievementsUnlocked,
    });
  }),
);

router.get(
  '/me/coupons',
  asyncHandler(async (req, res) => {
    const purchases = await CouponPurchase.find({ user: req.user._id })
      .sort({ acquiredAt: -1 })
      .lean();
    const businessIds = [
      ...new Set(purchases.map((purchase) => String(purchase.business))),
    ];
    const businesses = businessIds.length
      ? await Business.find({ _id: { $in: businessIds } })
          .select('slug name address')
          .lean()
      : [];
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );

    return res.json({
      purchases: purchases.map((purchase) =>
        serializePurchase(
          purchase,
          businessMap.get(String(purchase.business)),
        ),
      ),
    });
  }),
);

router.post(
  '/me/coupons/:id/activate',
  asyncHandler(async (req, res) => {
    const purchase = await CouponPurchase.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: 'acquired',
    });
    if (!purchase) {
      return res.status(404).json({ message: 'Cupón adquirido no encontrado.' });
    }
    if (purchase.expiresAt < new Date()) {
      purchase.status = 'expired';
      await purchase.save();
      return res.status(409).json({ message: 'Este cupón ya venció.' });
    }

    const location = req.body?.location;
    if (!isValidCoordinates(location)) {
      return res.status(400).json({
        message: 'Activa tu ubicación para confirmar que estás en el negocio.',
      });
    }

    const [business, settings] = await Promise.all([
      Business.findById(purchase.business).lean(),
      getPlatformSettings(),
    ]);
    if (!business || business.status !== 'approved') {
      return res.status(404).json({ message: 'Negocio no disponible.' });
    }
    if (!isValidCoordinates(business.location)) {
      return res.status(409).json({
        message: 'El negocio no tiene una ubicación validada para activar cupones.',
      });
    }

    const distance = distanceInMeters(location, business.location);
    if (distance === null || distance > settings.scanRadiusMeters) {
      return res.status(403).json({
        message: `Debes estar a menos de ${settings.scanRadiusMeters} m del negocio para activar el cupón.`,
        distanceMeters: distance === null ? null : Math.round(distance),
      });
    }

    purchase.status = 'activated';
    purchase.activatedAt = new Date();
    purchase.activationLocation = {
      lat: location.lat,
      lng: location.lng,
      distanceMeters: Math.round(distance),
    };
    await purchase.save();

    return res.json({
      purchase: serializePurchase(purchase, business),
      message:
        'Cupón activado. Muestra esta pantalla en el negocio para que acepten el canje.',
    });
  }),
);

router.get(
  '/me/points',
  asyncHandler(async (req, res) => {
    const summary = await getPointsSummary(req.user._id);
    return res.json(summary);
  }),
);

router.get(
  '/me/achievements',
  asyncHandler(async (req, res) => {
    const achievements = await getAchievementsForUser(req.user._id);
    return res.json({ achievements });
  }),
);

export default router;
