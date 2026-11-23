import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  Business,
  BusinessRequest,
  Category,
  Product,
  RankingSnapshot,
  Rating,
  User,
} from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  buildCategoryRanking,
  computeBusinessMetrics,
  getPeriod,
} from '../utils/scoring.js';
import {
  serializeBusiness,
  serializeCategory,
  serializeProduct,
  serializeRequest,
  serializeUser,
} from '../utils/serializers.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function uniqueSlug(name) {
  const base = slugify(name) || `negocio-${Date.now()}`;
  let slug = base;
  let counter = 2;
  while (await Business.exists({ slug })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      businesses,
      approvedBusinesses,
      pendingBusinesses,
      pendingRequests,
      users,
      products,
      ratings,
      snapshots,
    ] = await Promise.all([
      Business.countDocuments(),
      Business.countDocuments({ status: 'approved' }),
      Business.countDocuments({ status: 'pending' }),
      BusinessRequest.countDocuments({ status: 'pending' }),
      User.countDocuments(),
      Product.countDocuments({ isActive: true }),
      Rating.countDocuments(),
      RankingSnapshot.countDocuments(),
    ]);

    res.json({
      stats: {
        businesses,
        approvedBusinesses,
        pendingBusinesses,
        pendingRequests,
        users,
        products,
        ratings,
        snapshots,
      },
    });
  }),
);

router.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};
    const requests = await BusinessRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ requests: requests.map((request) => serializeRequest(request)) });
  }),
);

router.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const request = await BusinessRequest.findById(req.params.id).lean();
    if (!request) {
      return res.status(404).json({ message: 'Solicitud no encontrada.' });
    }
    res.json({ request: serializeRequest(request, { withCover: true }) });
  }),
);

router.patch(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const request = await BusinessRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Solicitud no encontrada.' });
    }

    if (request.status !== 'pending') {
      return res.status(409).json({
        message: 'Esta solicitud ya fue procesada.',
      });
    }

    const status = req.body.status;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Estado de solicitud no válido.' });
    }

    request.status = status;
    request.notes = req.body.notes || request.notes;
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();

    let credentials = null;
    if (status === 'approved') {
      const requestEmail = String(request.email).toLowerCase().trim();
      const existingUser = await User.findOne({ email: requestEmail });
      if (existingUser) {
        return res.status(409).json({
          message: 'Ya existe una cuenta con el correo de esta solicitud.',
        });
      }

      const temporaryPassword =
        req.body.password || randomBytes(6).toString('base64url');
      const business = await Business.create({
        slug: await uniqueSlug(request.businessName),
        name: request.businessName,
        categoryKey: request.categoryKey,
        categoryOther: request.categoryOther || '',
        municipality: request.municipality || '',
        parish: request.parish || '',
        sector: request.sector || '',
        hasDelivery: Boolean(request.hasDelivery),
        coverImage: request.coverImage || '',
        location: {
          lat: request.location?.lat ?? null,
          lng: request.location?.lng ?? null,
        },
        zone: request.parish || request.municipality || request.sector || request.zone || '',
        address: request.address,
        phone: request.phone,
        whatsapp: request.whatsapp,
        description: request.description,
        hours: request.hours,
        status: 'approved',
        isVerified: true,
        isOpen: false,
      });

      const user = await User.create({
        name: request.ownerName,
        email: requestEmail,
        passwordHash: await bcrypt.hash(temporaryPassword, 10),
        role: 'business',
        status: 'active',
        business: business._id,
      });
      business.owner = user._id;
      await business.save();

      credentials = {
        email: requestEmail,
        password: temporaryPassword,
      };
    }

    await request.save();
    res.json({
      request: serializeRequest(request),
      credentials,
      message:
        status === 'approved'
          ? 'Solicitud aprobada y cuenta de negocio creada.'
          : 'Solicitud rechazada.',
    });
  }),
);

router.get(
  '/businesses',
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};
    const [businesses, categories, products, ratings] = await Promise.all([
      Business.find(filter).sort({ createdAt: -1 }).lean(),
      Category.find({}).lean(),
      Product.find({}).lean(),
      Rating.find({}).lean(),
    ]);
    const categoryMap = new Map(categories.map((item) => [item.key, item]));

    const items = businesses.map((business) => {
      const metrics = computeBusinessMetrics({
        business,
        products: products.filter(
          (product) => String(product.business) === String(business._id),
        ),
        ratings: ratings.filter(
          (rating) => String(rating.business) === String(business._id),
        ),
        categories,
      });
      return serializeBusiness(
        business,
        metrics,
        categoryMap.get(business.categoryKey),
      );
    });

    res.json({ businesses: items });
  }),
);

router.patch(
  '/businesses/:id',
  asyncHandler(async (req, res) => {
    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({ message: 'Negocio no encontrado.' });
    }

    if (
      req.body.status !== undefined &&
      !['pending', 'approved', 'rejected', 'suspended'].includes(req.body.status)
    ) {
      return res.status(400).json({ message: 'Estado de negocio no válido.' });
    }
    if (
      req.body.premiumPlan !== undefined &&
      !['none', 'premium'].includes(req.body.premiumPlan)
    ) {
      return res.status(400).json({ message: 'Plan premium no válido.' });
    }
    if (
      req.body.premiumUntil !== undefined &&
      req.body.premiumUntil !== null &&
      Number.isNaN(Date.parse(req.body.premiumUntil))
    ) {
      return res.status(400).json({ message: 'Fecha de premium no válida.' });
    }

    const allowed = [
      'status',
      'isVerified',
      'isOpen',
      'premiumPlan',
      'premiumUntil',
      'recognition',
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) business[key] = req.body[key];
    }
    await business.save();
    if (business.owner) {
      await User.findByIdAndUpdate(business.owner, {
        status: business.status === 'approved' ? 'active' : 'suspended',
      });
    }
    res.json({ business: serializeBusiness(business) });
  }),
);

router.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const [products, businesses, categories, ratings] = await Promise.all([
      Product.find({}).sort({ createdAt: -1 }).lean(),
      Business.find({}).lean(),
      Category.find({}).lean(),
      Rating.find({}).lean(),
    ]);
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );
    const categoryMap = new Map(categories.map((item) => [item.key, item]));
    const ratingsByProduct = new Map();
    for (const rating of ratings) {
      const key = String(rating.product);
      if (!ratingsByProduct.has(key)) ratingsByProduct.set(key, []);
      ratingsByProduct.get(key).push(rating);
    }

    const items = products.map((product) => {
      const business = businessMap.get(String(product.business));
      const productRatings = ratingsByProduct.get(String(product._id)) || [];
      const averageScore = productRatings.length
        ? productRatings.reduce((total, rating) => total + rating.score, 0) /
          productRatings.length
        : null;
      return {
        ...serializeProduct(product, business, {
          averageScore,
          ratingsCount: productRatings.length,
        }),
        businessName: business?.name || 'Sin negocio',
        categoryName:
          categoryMap.get(product.categoryKey)?.name || product.categoryKey,
      };
    });

    res.json({ products: items });
  }),
);

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    const businessIds = users
      .map((user) => user.business)
      .filter(Boolean);
    const businesses = businessIds.length
      ? await Business.find({ _id: { $in: businessIds } })
          .select('name slug')
          .lean()
      : [];
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );

    res.json({
      users: users.map((user) => {
        const business = user.business
          ? businessMap.get(String(user.business))
          : null;
        return {
          ...serializeUser(user),
          businessName: business?.name || null,
          businessSlug: business?.slug || null,
        };
      }),
    });
  }),
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').toLowerCase().trim();
    const providedPassword = req.body.password ? String(req.body.password) : '';

    if (!name || !email) {
      return res.status(400).json({ message: 'Nombre y correo son obligatorios.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'El correo no es válido.' });
    }
    if (providedPassword && providedPassword.length < 8) {
      return res.status(400).json({
        message: 'La contraseña debe tener al menos 8 caracteres.',
      });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ message: 'Ya existe una cuenta con ese correo.' });
    }

    const temporaryPassword =
      providedPassword || randomBytes(6).toString('base64url');
    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(temporaryPassword, 10),
      role: 'admin',
      status: 'active',
    });

    res.status(201).json({
      user: serializeUser(user),
      credentials: { email, password: temporaryPassword },
    });
  }),
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (!['active', 'pending', 'suspended'].includes(req.body.status)) {
      return res.status(400).json({ message: 'Estado de usuario no válido.' });
    }

    if (
      String(req.user._id) === String(req.params.id) &&
      req.body.status !== 'active'
    ) {
      return res.status(400).json({
        message: 'No puedes suspender tu propia cuenta de administrador.',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true },
    );
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    res.json({ user: serializeUser(user) });
  }),
);

router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const providedPassword = req.body?.password
      ? String(req.body.password)
      : '';
    if (providedPassword && providedPassword.length < 8) {
      return res.status(400).json({
        message: 'La contraseña debe tener al menos 8 caracteres.',
      });
    }

    const password =
      providedPassword || randomBytes(6).toString('base64url');
    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    res.json({
      message: 'Contraseña actualizada.',
      user: serializeUser(user),
      credentials: {
        email: user.email,
        password,
      },
    });
  }),
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await Category.find({}).sort({ order: 1 }).lean();
    res.json({ categories: categories.map(serializeCategory) });
  }),
);

router.patch(
  '/categories/:key',
  asyncHandler(async (req, res) => {
    const average =
      req.body.average !== undefined ? Number(req.body.average) : undefined;
    const order = req.body.order !== undefined ? Number(req.body.order) : undefined;

    if (average !== undefined && (!Number.isFinite(average) || average < 1 || average > 5)) {
      return res.status(400).json({ message: 'El promedio debe estar entre 1 y 5.' });
    }
    if (order !== undefined && !Number.isInteger(order)) {
      return res.status(400).json({ message: 'El orden debe ser un número entero.' });
    }
    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ message: 'El nombre de la categoría es obligatorio.' });
    }
    if (req.body.image !== undefined && !String(req.body.image).trim()) {
      return res.status(400).json({ message: 'La imagen de la categoría es obligatoria.' });
    }

    const category = await Category.findOneAndUpdate(
      { key: req.params.key },
      {
        $set: {
          ...(req.body.name !== undefined && { name: req.body.name }),
          ...(req.body.image !== undefined && { image: req.body.image }),
          ...(average !== undefined && { average }),
          ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
          ...(order !== undefined && { order }),
        },
      },
      { new: true },
    );
    if (!category) {
      return res.status(404).json({ message: 'Categoría no encontrada.' });
    }
    res.json({ category: serializeCategory(category) });
  }),
);

router.get(
  '/rankings',
  asyncHandler(async (req, res) => {
    const filter = req.query.period ? { period: req.query.period } : {};
    const snapshots = await RankingSnapshot.find(filter)
      .sort({ period: -1, categoryKey: 1 })
      .lean();
    res.json({ snapshots });
  }),
);

router.post(
  '/rankings/publish',
  asyncHandler(async (req, res) => {
    const period = req.body.period || getPeriod();
    const [categories, products, ratings, businesses] = await Promise.all([
      Category.find({ isActive: true }).lean(),
      Product.find({ isActive: true }).lean(),
      Rating.find({}).lean(),
      Business.find({ status: 'approved' }).lean(),
    ]);
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );

    const snapshots = [];
    let skippedCategories = 0;

    for (const category of categories) {
      const ranking = buildCategoryRanking({
        products,
        ratings,
        categories,
        categoryKey: category.key,
      }).slice(0, 3);

      if (ranking.length === 0) {
        skippedCategories += 1;
        continue;
      }

      const snapshot = await RankingSnapshot.findOneAndUpdate(
        { period, categoryKey: category.key },
        {
          $set: {
            rankings: ranking.map((item) => ({
              position: item.position,
              product: item.product._id,
              business: item.product.business,
              productName: item.product.name,
              businessName:
                businessMap.get(String(item.product.business))?.name || '',
              score: item.metrics.score,
              ratingsCount: item.metrics.ratingsCount,
            })),
            publishedBy: req.user._id,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      snapshots.push(snapshot);

      const top = ranking[0];
      if (top) {
        await Business.updateOne(
          { _id: top.product.business },
          {
            $set: {
              recognition: {
                position: 1,
                categoryKey: category.key,
                productName: top.product.name,
                period,
                status: 'validado',
              },
            },
          },
        );
      }
    }

    const message = snapshots.length
      ? `Rankings de ${period} publicados${
          skippedCategories
            ? `; ${skippedCategories} categorías sin calificaciones suficientes.`
            : '.'
        }`
      : `No hay suficientes calificaciones para publicar rankings de ${period}.`;

    res.json({
      period,
      snapshots,
      message,
    });
  }),
);

router.delete(
  '/ratings/:id',
  asyncHandler(async (req, res) => {
    const rating = await Rating.findByIdAndDelete(req.params.id);
    if (!rating) {
      return res.status(404).json({ message: 'Calificación no encontrada.' });
    }
    res.json({ ok: true });
  }),
);

export default router;
