import { Router } from 'express';
import {
  Business,
  BusinessRequest,
  Category,
  Product,
  Promotion,
  Rating,
} from '../models/index.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  buildCategoryRanking,
  computeBusinessMetrics,
  computeProductMetrics,
  getPeriod,
} from '../utils/scoring.js';
import {
  serializeBusiness,
  serializeCategory,
  serializeProduct,
  serializeRequest,
} from '../utils/serializers.js';

const router = Router();

const TERMS_VERSION = '2026-11';
const MAX_COVER_LENGTH = 700_000;

async function getCatalog() {
  const [categories, businesses, products, ratings] = await Promise.all([
    Category.find({ isActive: true }).sort({ order: 1, name: 1 }).lean(),
    Business.find({ status: 'approved' }).lean(),
    Product.find({ isActive: true }).lean(),
    Rating.find({}).lean(),
  ]);

  return { categories, businesses, products, ratings };
}

function businessMetrics(business, products, ratings, categories) {
  return computeBusinessMetrics({
    business,
    products: products.filter(
      (product) => String(product.business) === String(business._id),
    ),
    ratings: ratings.filter(
      (rating) => String(rating.business) === String(business._id),
    ),
    categories,
  });
}

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const { categories, businesses, products, ratings } = await getCatalog();
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );

    const items = categories.map((category) => {
      const ranking = buildCategoryRanking({
        products,
        ratings,
        categories,
        categoryKey: category.key,
      }).slice(0, 1);
      const top = ranking[0];
      const business = top
        ? businessMap.get(String(top.product.business))
        : null;
      return {
        ...serializeCategory(category),
        top: top
          ? {
              product: serializeProduct(top.product, business, top.metrics),
              business: business
                ? serializeBusiness(business, {}, category)
                : null,
              score: top.metrics.score,
              ratingsCount: top.metrics.ratingsCount,
            }
          : null,
      };
    });

    res.json({ categories: items });
  }),
);

router.get(
  '/promotions',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const promotions = await Promotion.find({ isActive: true })
      .sort({ order: 1, createdAt: -1 })
      .lean();
    const activePromotions = promotions.filter(
      (promotion) =>
        (!promotion.startsAt || promotion.startsAt <= now) &&
        (!promotion.endsAt || promotion.endsAt >= now),
    );
    const productIds = activePromotions.map((promotion) => promotion.product);
    const [products, businesses] = await Promise.all([
      Product.find({ _id: { $in: productIds }, isActive: true }).lean(),
      Business.find({ status: 'approved' }).lean(),
    ]);
    const productMap = new Map(
      products.map((product) => [String(product._id), product]),
    );
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );

    res.json({
      promotions: activePromotions
        .filter((promotion) => productMap.has(String(promotion.product)))
        .map((promotion) => {
          const product = productMap.get(String(promotion.product));
          const business = businessMap.get(String(promotion.business));
          return {
            id: String(promotion._id),
            title: promotion.title,
            note: promotion.note || '',
            badge: promotion.badge || 'Oferta',
            emoji: promotion.emoji || product.emoji || '🍽️',
            tone: promotion.tone || 'accent',
            price: promotion.price,
            originalPrice: promotion.originalPrice,
            productId: String(product._id),
            businessId: business?.slug || '',
            businessName: business?.name || '',
          };
        }),
    });
  }),
);

router.get(
  '/businesses',
  asyncHandler(async (req, res) => {
    const { open, category, q } = req.query;
    const { categories, businesses, products, ratings } = await getCatalog();
    const categoryMap = new Map(categories.map((item) => [item.key, item]));
    const normalizedQuery = String(q || '').toLowerCase().trim();

    const items = businesses
      .filter((business) => {
        if (open === '1' && !business.isOpen) return false;
        if (category && category !== 'todos') {
          const hasCategory = products.some(
            (product) =>
              String(product.business) === String(business._id) &&
              product.categoryKey === category,
          );
          if (!hasCategory) return false;
        }
        if (!normalizedQuery) return true;
        return `${business.name} ${business.municipality} ${business.parish} ${business.sector} ${business.zone} ${business.address}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .map((business) => {
        const metrics = businessMetrics(business, products, ratings, categories);
        return serializeBusiness(
          business,
          metrics,
          categoryMap.get(business.categoryKey),
          { withCover: true },
        );
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json({ businesses: items });
  }),
);

router.get(
  '/businesses/:slug',
  asyncHandler(async (req, res) => {
    const business = await Business.findOne({
      slug: req.params.slug,
      status: 'approved',
    }).lean();
    if (!business) {
      return res.status(404).json({ message: 'Establecimiento no encontrado.' });
    }

    const [categories, products, ratings] = await Promise.all([
      Category.find({ isActive: true }).lean(),
      Product.find({ business: business._id, isActive: true }).lean(),
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

    return res.json({
      business: serializeBusiness(
        business,
        metrics,
        categoryMap.get(business.categoryKey),
        { withCover: true },
      ),
      products: products.map((product) =>
        serializeProduct(product, business, metricsMap.get(String(product._id))),
      ),
    });
  }),
);

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { category, q, open } = req.query;
    const { categories, businesses, products, ratings } = await getCatalog();
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );
    const categoryMap = new Map(categories.map((item) => [item.key, item]));
    const normalizedQuery = String(q || '').toLowerCase().trim();

    const ratingsByProduct = new Map();
    for (const rating of ratings) {
      const key = String(rating.product);
      if (!ratingsByProduct.has(key)) ratingsByProduct.set(key, []);
      ratingsByProduct.get(key).push(rating);
    }

    const items = products
      .filter((product) => {
        const business = businessMap.get(String(product.business));
        if (!business) return false;
        if (category && category !== 'todos' && product.categoryKey !== category) {
          return false;
        }
        if (open === '1' && !business.isOpen) return false;
        if (!normalizedQuery) return true;
        return `${product.name} ${product.description} ${business.name} ${business.zone}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .map((product) => {
        const business = businessMap.get(String(product.business));
        const metrics = computeProductMetrics(
          product,
          ratingsByProduct.get(String(product._id)) || [],
          categoryMap.get(product.categoryKey)?.average ?? 4.2,
        );
        return serializeProduct(product, business, metrics);
      })
      .sort(
        (a, b) =>
          (b.score || 0) - (a.score || 0) ||
          (b.ratingsCount || 0) - (a.ratingsCount || 0),
      );

    res.json({ products: items });
  }),
);

router.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).lean();
    if (!product) {
      return res.status(404).json({ message: 'Plato no encontrado.' });
    }
    const [business, category, ratings] = await Promise.all([
      Business.findById(product.business).lean(),
      Category.findOne({ key: product.categoryKey }).lean(),
      Rating.find({ product: product._id }).lean(),
    ]);
    if (!business || business.status !== 'approved') {
      return res.status(404).json({ message: 'Plato no disponible.' });
    }
    const metrics = computeProductMetrics(
      product,
      ratings,
      category?.average ?? 4.2,
    );
    return res.json({
      product: serializeProduct(product, business, metrics),
      business: serializeBusiness(business, {}, category),
      category: category ? serializeCategory(category) : null,
    });
  }),
);

router.get(
  '/rankings/:categoryKey',
  asyncHandler(async (req, res) => {
    const { categories, businesses, products, ratings } = await getCatalog();
    const category = categories.find((item) => item.key === req.params.categoryKey);
    if (!category) {
      return res.status(404).json({ message: 'Categoría no encontrada.' });
    }
    const businessMap = new Map(
      businesses.map((business) => [String(business._id), business]),
    );
    const ranking = buildCategoryRanking({
      products,
      ratings,
      categories,
      categoryKey: category.key,
    }).slice(0, 3);

    return res.json({
      category: serializeCategory(category),
      ranking: ranking.map((item) => {
        const business = businessMap.get(String(item.product.business));
        return {
          position: item.position,
          product: serializeProduct(item.product, business, item.metrics),
          business: business
            ? serializeBusiness(business, {}, category)
            : null,
        };
      }),
    });
  }),
);

router.get(
  '/ratings/:productId',
  asyncHandler(async (req, res) => {
    const { deviceId, period } = req.query;
    if (!deviceId) return res.json({ rating: null });
    const rating = await Rating.findOne({
      product: req.params.productId,
      deviceId,
      period: period || getPeriod(),
    }).lean();
    res.json({
      rating: rating
        ? {
            id: String(rating._id),
            productId: String(rating.product),
            score: rating.score,
            period: rating.period,
            updatedAt: rating.updatedAt,
          }
        : null,
    });
  }),
);

router.post(
  '/ratings',
  asyncHandler(async (req, res) => {
    const { productId, deviceId, score } = req.body || {};
    const numericScore = Number(score);

    if (!productId || !deviceId) {
      return res
        .status(400)
        .json({ message: 'Faltan el plato o el identificador del dispositivo.' });
    }
    if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 5) {
      return res
        .status(400)
        .json({ message: 'La puntuación debe ser un entero entre 1 y 5.' });
    }

    const product = await Product.findById(productId).lean();
    if (!product || product.isActive === false) {
      return res.status(404).json({ message: 'Plato no encontrado.' });
    }
    const business = await Business.findById(product.business).lean();
    if (!business || business.status !== 'approved') {
      return res.status(404).json({ message: 'Establecimiento no disponible.' });
    }

    const period = getPeriod();
    const rating = await Rating.findOneAndUpdate(
      {
        product: product._id,
        deviceId: String(deviceId),
        period,
      },
      {
        $set: { score: numericScore, business: business._id },
        $setOnInsert: { product: product._id, deviceId: String(deviceId), period },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const [category, ratings] = await Promise.all([
      Category.findOne({ key: product.categoryKey }).lean(),
      Rating.find({ product: product._id }).lean(),
    ]);
    const metrics = computeProductMetrics(
      product,
      ratings,
      category?.average ?? 4.2,
    );

    return res.status(201).json({
      rating: {
        id: String(rating._id),
        productId: String(product._id),
        score: rating.score,
        period: rating.period,
      },
      product: serializeProduct(product, business, metrics),
    });
  }),
);

router.post(
  '/business-requests',
  asyncHandler(async (req, res) => {
    const {
      businessName,
      ownerName,
      email,
      phone,
      whatsapp,
      categoryKey,
      categoryOther,
      municipality,
      parish,
      sector,
      address,
      location,
      hasDelivery,
      coverImage,
      termsAccepted,
      description,
      hours,
    } = req.body || {};

    const otherCategory = categoryKey === 'otro';
    const lat = location?.lat;
    const lng = location?.lng;

    if (
      !businessName ||
      !ownerName ||
      !email ||
      !phone ||
      !whatsapp ||
      !categoryKey ||
      !municipality ||
      !parish ||
      !address ||
      typeof hasDelivery !== 'boolean' ||
      !coverImage
    ) {
      return res.status(400).json({
        message: 'Completa los datos obligatorios de la solicitud.',
      });
    }
    if (otherCategory && String(categoryOther || '').trim().length < 2) {
      return res.status(400).json({
        message: 'Escribe el tipo de negocio en la opción "Otro".',
      });
    }
    if (!otherCategory && !(await Category.exists({ key: categoryKey, isActive: true }))) {
      return res.status(400).json({ message: 'Categoría no válida.' });
    }
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        message: 'Indica la ubicación del negocio en el mapa o con tu ubicación actual.',
      });
    }
    if (
      !/^data:image\/(jpeg|png|webp);base64,/.test(String(coverImage)) ||
      String(coverImage).length > MAX_COVER_LENGTH
    ) {
      return res.status(400).json({
        message: 'La foto de portada debe ser JPG, PNG o WebP y pesar menos de 500 KB.',
      });
    }
    if (termsAccepted !== true) {
      return res.status(400).json({
        message: 'Debes aceptar los términos y la política de privacidad.',
      });
    }

    const existing = await BusinessRequest.findOne({
      email: String(email).toLowerCase(),
      status: 'pending',
    });
    if (existing) {
      return res.status(409).json({
        message: 'Ya existe una solicitud pendiente con ese correo.',
      });
    }

    const normalizedSector = String(sector || '').trim();
    const request = await BusinessRequest.create({
      businessName: String(businessName).trim(),
      ownerName: String(ownerName).trim(),
      email: String(email).toLowerCase().trim(),
      phone: String(phone).trim(),
      whatsapp: String(whatsapp).trim(),
      categoryKey,
      categoryOther: otherCategory ? String(categoryOther).trim() : '',
      municipality: String(municipality).trim(),
      parish: String(parish).trim(),
      sector: normalizedSector,
      zone: normalizedSector || String(parish).trim() || String(municipality).trim(),
      address: String(address).trim(),
      location: { lat, lng },
      hasDelivery,
      coverImage,
      description: String(description || '').trim(),
      hours: String(hours || '').trim(),
      terms: { acceptedAt: new Date(), version: TERMS_VERSION },
    });

    return res.status(201).json({ request: serializeRequest(request) });
  }),
);

export default router;
