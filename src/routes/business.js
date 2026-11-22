import { Router } from 'express';
import { Business, Category, Product, Rating } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  computeBusinessMetrics,
  computeProductMetrics,
} from '../utils/scoring.js';
import {
  serializeBusiness,
  serializeProduct,
} from '../utils/serializers.js';

const router = Router();

const MAX_IMAGE_LENGTH = 700_000;

function isValidImage(image) {
  if (image === undefined || image === '') return true;
  return (
    typeof image === 'string' &&
    /^data:image\/(jpeg|png|webp);base64,/.test(image) &&
    image.length <= MAX_IMAGE_LENGTH
  );
}

async function loadBusiness(req, res, next) {
  const business = await Business.findOne({ owner: req.user._id });
  if (!business) {
    return res.status(404).json({ message: 'No hay un negocio asociado a esta cuenta.' });
  }
  if (business.status !== 'approved') {
    return res.status(403).json({ message: 'El negocio no está aprobado.' });
  }
  req.business = business;
  return next();
}

router.use(requireAuth, requireRole('business'), asyncHandler(loadBusiness));

async function businessBundle(business) {
  const [categories, products, ratings] = await Promise.all([
    Category.find({ isActive: true }).lean(),
    Product.find({ business: business._id }).lean(),
    Rating.find({ business: business._id }).lean(),
  ]);
  const categoryMap = new Map(categories.map((item) => [item.key, item]));
  const metrics = computeBusinessMetrics({
    business,
    products,
    ratings,
    categories,
  });
  const metricsMap = new Map(
    metrics.productMetrics.map((item) => [
      String(item.product._id),
      item.metrics,
    ]),
  );

  return {
    categories,
    products,
    metrics,
    business: serializeBusiness(
      business,
      metrics,
      categoryMap.get(business.categoryKey),
      { withCover: true },
    ),
    serializedProducts: products
      .map((product) =>
        serializeProduct(product, business, metricsMap.get(String(product._id))),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const bundle = await businessBundle(req.business);
    res.json({
      business: bundle.business,
      products: bundle.serializedProducts,
      categories: bundle.categories.map((category) => ({
        id: category.key,
        label: category.name,
        image: category.image,
      })),
      metrics: {
        score: bundle.metrics.score,
        ratingsCount: bundle.metrics.ratingsCount,
        ratedProducts: bundle.metrics.ratedProducts,
        activeProducts: bundle.metrics.activeProducts,
        availableProducts: bundle.metrics.availableProducts,
        categories: bundle.metrics.categories,
      },
    });
  }),
);

router.put(
  '/me',
  asyncHandler(async (req, res) => {
    const allowed = [
      'name',
      'categoryKey',
      'zone',
      'address',
      'phone',
      'whatsapp',
      'description',
      'hours',
      'emoji',
      'isOpen',
      'municipality',
      'parish',
      'sector',
      'categoryOther',
      'hasDelivery',
      'coverImage',
      'location',
    ];
    if (!isValidImage(req.body.coverImage)) {
      return res.status(400).json({
        message: 'La foto de portada debe ser JPG, PNG o WebP y pesar menos de 500 KB.',
      });
    }
    if (req.body.location !== undefined) {
      const lat = req.body.location?.lat;
      const lng = req.body.location?.lng;
      const hasCoordinates = lat !== null && lng !== null;
      if (
        hasCoordinates &&
        (typeof lat !== 'number' ||
          typeof lng !== 'number' ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          lat < -90 ||
          lat > 90 ||
          lng < -180 ||
          lng > 180)
      ) {
        return res.status(400).json({ message: 'Ubicación no válida.' });
      }
    }
    for (const key of allowed) {
      if (req.body[key] !== undefined) req.business[key] = req.body[key];
    }
    await req.business.save();
    res.json({ business: serializeBusiness(req.business) });
  }),
);

router.patch(
  '/me/status',
  asyncHandler(async (req, res) => {
    req.business.isOpen = Boolean(req.body.isOpen);
    await req.business.save();
    res.json({ business: serializeBusiness(req.business) });
  }),
);

router.get(
  '/me/products',
  asyncHandler(async (req, res) => {
    const bundle = await businessBundle(req.business);
    res.json({ products: bundle.serializedProducts });
  }),
);

router.post(
  '/me/products',
  asyncHandler(async (req, res) => {
    const { name, description, price, categoryKey, emoji, image } = req.body || {};
    const numericPrice = Number(price);
    if (!name || !categoryKey || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({
        message: 'Nombre, categoría y precio válido son obligatorios.',
      });
    }
    if (!isValidImage(image)) {
      return res.status(400).json({
        message: 'La imagen del plato debe ser JPG, PNG o WebP y pesar menos de 500 KB.',
      });
    }
    const category = await Category.findOne({ key: categoryKey, isActive: true });
    if (!category) {
      return res.status(400).json({ message: 'Categoría no válida.' });
    }
    const product = await Product.create({
      business: req.business._id,
      categoryKey,
      name,
      description: description || '',
      price: numericPrice,
      emoji: emoji || '🍽️',
      image: image || '',
      isAvailable: req.body.isAvailable ?? true,
      isActive: req.body.isActive ?? true,
    });
    res.status(201).json({ product: serializeProduct(product, req.business, {}) });
  }),
);

router.put(
  '/me/products/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({
      _id: req.params.id,
      business: req.business._id,
    });
    if (!product) {
      return res.status(404).json({ message: 'Plato no encontrado.' });
    }
    const allowed = [
      'name',
      'description',
      'price',
      'categoryKey',
      'emoji',
      'image',
      'isActive',
      'isAvailable',
    ];
    if (!isValidImage(req.body.image)) {
      return res.status(400).json({
        message: 'La imagen del plato debe ser JPG, PNG o WebP y pesar menos de 500 KB.',
      });
    }
    for (const key of allowed) {
      if (req.body[key] !== undefined) product[key] = req.body[key];
    }
    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ message: 'Precio no válido.' });
      }
      product.price = price;
    }
    await product.save();
    res.json({ product: serializeProduct(product, req.business, {}) });
  }),
);

router.delete(
  '/me/products/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { $set: { isActive: false } },
      { new: true },
    );
    if (!product) {
      return res.status(404).json({ message: 'Plato no encontrado.' });
    }
    res.json({ ok: true });
  }),
);

router.get(
  '/me/metrics',
  asyncHandler(async (req, res) => {
    const bundle = await businessBundle(req.business);
    res.json({ metrics: bundle.metrics });
  }),
);

export default router;
