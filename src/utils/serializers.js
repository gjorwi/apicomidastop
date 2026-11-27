import { getProductPrices, lowestPrice } from './prices.js';

function formatDisplayName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';

  const lower = text.toLocaleLowerCase('es');
  const upper = text.toLocaleUpperCase('es');
  // Respeta nombres que ya tienen una combinación intencional de mayúsculas.
  if (text !== lower && text !== upper) return text;

  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}

export function serializeCategory(category) {
  return {
    id: category.key,
    key: category.key,
    label: category.name,
    name: category.name,
    image: category.image,
    average: category.average,
    order: category.order,
    isActive: category.isActive,
  };
}

export function serializeBusiness(business, metrics = {}, category = null, options = {}) {
  const categoryLabel =
    category?.name ||
    (business.categoryKey === 'otro'
      ? business.categoryOther || 'Otro'
      : business.categoryKey);
  const offeredCategories = metrics.offeredCategories?.length
    ? metrics.offeredCategories
    : categoryLabel
      ? [{ id: business.categoryKey, label: categoryLabel }]
      : [];

  return {
    id: business.slug,
    _id: String(business._id),
    name: formatDisplayName(business.name),
    categoryKey: business.categoryKey,
    category: categoryLabel,
    categoryOther: business.categoryOther || '',
    zone: business.zone,
    municipality: business.municipality || '',
    parish: business.parish || '',
    sector: business.sector || '',
    location: {
      lat: business.location?.lat ?? null,
      lng: business.location?.lng ?? null,
    },
    hasDelivery: Boolean(business.hasDelivery),
    deliveryShortFee: business.deliveryShortFee ?? null,
    deliveryLongFee: business.deliveryLongFee ?? null,
    freeDeliveryFrom: business.freeDeliveryFrom ?? null,
    address: business.address,
    locationReference: business.locationReference || '',
    phone: business.phone,
    whatsapp: business.whatsapp,
    description: business.description,
    hours: business.hours,
    emoji: business.emoji,
    isOpen: business.isOpen,
    isVerified: business.isVerified,
    status: business.status,
    premiumPlan: business.premiumPlan,
    premiumUntil: business.premiumUntil,
    score: metrics.score ?? null,
    ratingsCount: metrics.ratingsCount ?? 0,
    ratedProducts: metrics.ratedProducts ?? 0,
    activeProducts: metrics.activeProducts ?? 0,
    categories: metrics.categories || [],
    offeredCategories,
    recognition: business.recognition?.status
      ? {
          position: business.recognition.position,
          category: categoryLabel,
          productName: business.recognition.productName,
          city: 'Coro',
          status: business.recognition.status,
        }
      : null,
    createdAt: business.createdAt,
    ...(options.withCover ? { coverImage: business.coverImage || '' } : {}),
  };
}

export function serializeProduct(product, business = null, metrics = {}) {
  const prices = getProductPrices(product);

  return {
    id: String(product._id),
    _id: String(product._id),
    name: formatDisplayName(product.name),
    businessId: business?.slug || String(product.business),
    businessName: business ? formatDisplayName(business.name) : null,
    businessMunicipality: business?.municipality || '',
    businessParish: business?.parish || '',
    businessSector: business?.sector || '',
    categoryId: product.categoryKey,
    averageScore: metrics.averageScore ?? null,
    score: metrics.score ?? null,
    ratingsCount: metrics.ratingsCount ?? 0,
    totalRatings: metrics.totalRatings ?? 0,
    price: lowestPrice(prices) ?? product.price,
    prices,
    description: product.description,
    emoji: product.emoji,
    image: product.image || '',
    isActive: product.isActive,
    isAvailable: product.isAvailable,
    createdAt: product.createdAt,
  };
}

export function serializeUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    avatar: user.avatar || '',
    authProvider: user.authProvider || 'password',
    lastLoginAt: user.lastLoginAt || null,
    points: user.points || 0,
    business: user.business ? String(user.business) : null,
    createdAt: user.createdAt,
  };
}

export function serializeVisit(visit) {
  const maxVotes = visit.maxVotes ?? 2;
  const votesUsed = visit.votesUsed ?? 0;
  return {
    id: String(visit._id),
    businessId: String(visit.business),
    status: visit.status,
    votesUsed,
    maxVotes,
    votesRemaining: Math.max(0, maxVotes - votesUsed),
    expiresAt: visit.expiresAt,
    createdAt: visit.createdAt,
  };
}

export function serializeRequest(request, options = {}) {
  return {
    id: String(request._id),
    businessName: formatDisplayName(request.businessName),
    ownerName: request.ownerName,
    email: request.email,
    phone: request.phone,
    whatsapp: request.whatsapp,
    categoryKey: request.categoryKey,
    zone: request.zone,
    address: request.address,
    description: request.description,
    hours: request.hours,
    categoryOther: request.categoryOther || '',
    municipality: request.municipality || '',
    parish: request.parish || '',
    sector: request.sector || '',
    location: {
      lat: request.location?.lat ?? null,
      lng: request.location?.lng ?? null,
    },
    hasDelivery: Boolean(request.hasDelivery),
    ...(options.withCover ? { coverImage: request.coverImage || '' } : {}),
    termsAcceptedAt: request.terms?.acceptedAt || null,
    termsVersion: request.terms?.version || '',
    status: request.status,
    notes: request.notes,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
  };
}
