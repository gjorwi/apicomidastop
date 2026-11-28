import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const CategorySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    image: { type: String, required: true },
    average: { type: Number, default: 4.2, min: 1, max: 5 },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const BusinessSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    categoryKey: { type: String, required: true, trim: true },
    zone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    hours: { type: String, default: '' },
    emoji: { type: String, default: '🍽️' },
    categoryOther: { type: String, default: '', trim: true },
    municipality: { type: String, default: '', trim: true },
    parish: { type: String, default: '', trim: true },
    sector: { type: String, default: '', trim: true },
    hasDelivery: { type: Boolean, default: false },
    deliveryShortFee: { type: Number, default: null, min: 0 },
    deliveryLongFee: { type: Number, default: null, min: 0 },
    freeDeliveryFrom: { type: Number, default: null, min: 0 },
    coverImage: { type: String, default: '' },
    logoImage: { type: String, default: '' },
    featuredAd: {
      isActive: { type: Boolean, default: false },
      position: { type: Number, default: 1, min: 1, max: 99 },
    },
    locationReference: { type: String, default: '', trim: true },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    isOpen: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    premiumPlan: {
      type: String,
      enum: ['none', 'premium'],
      default: 'none',
    },
    premiumUntil: { type: Date, default: null },
    recognition: {
      position: { type: Number, default: null },
      categoryKey: { type: String, default: null },
      productName: { type: String, default: null },
      period: { type: String, default: null },
      status: { type: String, default: null },
    },
  },
  { timestamps: true },
);

const ProductSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    categoryKey: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    prices: {
      unique: { type: Number, default: null, min: 0 },
      small: { type: Number, default: null, min: 0 },
      medium: { type: Number, default: null, min: 0 },
      large: { type: Number, default: null, min: 0 },
    },
    emoji: { type: String, default: '🍽️' },
    image: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const RatingSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    deviceId: { type: String, required: true, trim: true },
    period: { type: String, required: true, index: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

RatingSchema.index(
  { product: 1, deviceId: 1, period: 1 },
  { unique: true },
);

RatingSchema.index(
  { product: 1, user: 1, period: 1 },
  { unique: true, partialFilterExpression: { user: { $ne: null } } },
);

export const BUSINESS_EVENT_TYPES = [
  'call',
  'whatsapp',
  'directions',
  'menu_view',
  'business_view',
  'business_share',
  'dish_share',
];

const BusinessEventSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    type: { type: String, enum: BUSINESS_EVENT_TYPES, required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deviceId: { type: String, default: '', trim: true },
    channel: { type: String, default: '', trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

BusinessEventSchema.index({ business: 1, type: 1, createdAt: -1 });
BusinessEventSchema.index({ business: 1, createdAt: -1 });

export const ACHIEVEMENT_REQUIREMENT_TYPES = [
  'ratings_count',
  'categories_count',
  'businesses_count',
  'active_days',
  'coupons_acquired',
  'coupons_used',
];

const AchievementSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '🏆' },
    requirementType: {
      type: String,
      enum: ACHIEVEMENT_REQUIREMENT_TYPES,
      required: true,
    },
    requirementValue: { type: Number, required: true, min: 1 },
    rewardPoints: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

const UserAchievementSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    achievement: {
      type: Schema.Types.ObjectId,
      ref: 'Achievement',
      required: true,
      index: true,
    },
    progress: { type: Number, default: 0, min: 0 },
    unlockedAt: { type: Date, default: null },
    rewardGrantedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UserAchievementSchema.index({ user: 1, achievement: 1 }, { unique: true });

const CouponSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    emoji: { type: String, default: '🎁' },
    pointsCost: { type: Number, required: true, min: 1 },
    stock: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: 1 },
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
    validityDays: { type: Number, default: 30, min: 1 },
    terms: { type: String, default: '' },
    status: {
      type: String,
      enum: ['active', 'paused', 'ended'],
      default: 'active',
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

CouponSchema.index({ business: 1, status: 1 });

const CouponPurchaseSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pointsSpent: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['acquired', 'activated', 'used', 'expired', 'rejected'],
      default: 'acquired',
      index: true,
    },
    acquiredAt: { type: Date, default: Date.now },
    activatedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true, index: true },
    activationLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      distanceMeters: { type: Number, default: null },
    },
    snapshot: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      emoji: { type: String, default: '🎁' },
      validityDays: { type: Number, default: 30 },
    },
  },
  { timestamps: true },
);

CouponPurchaseSchema.index({ user: 1, status: 1 });
CouponPurchaseSchema.index({ business: 1, status: 1, activatedAt: -1 });
CouponPurchaseSchema.index({ coupon: 1, user: 1, status: 1 });

const PointTransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    business: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    rating: { type: Schema.Types.ObjectId, ref: 'Rating', default: null },
    achievement: { type: Schema.Types.ObjectId, ref: 'Achievement', default: null },
    purchase: { type: Schema.Types.ObjectId, ref: 'CouponPurchase', default: null },
    type: {
      type: String,
      enum: [
        'welcome',
        'rating',
        'rating_first_business',
        'achievement',
        'coupon_acquire',
        'coupon_refund',
        'adjustment',
      ],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    description: { type: String, default: '' },
  },
  { timestamps: true },
);

PointTransactionSchema.index({ user: 1, createdAt: -1 });
PointTransactionSchema.index(
  { rating: 1 },
  { unique: true, partialFilterExpression: { rating: { $ne: null } } },
);
PointTransactionSchema.index(
  { user: 1, achievement: 1 },
  { unique: true, partialFilterExpression: { achievement: { $ne: null } } },
);
PointTransactionSchema.index(
  { purchase: 1, type: 1 },
  { unique: true, partialFilterExpression: { purchase: { $ne: null } } },
);
PointTransactionSchema.index(
  { user: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: 'welcome' } },
);
PointTransactionSchema.index(
  { user: 1, business: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: 'rating_first_business' } },
);

const VisitSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    deviceId: { type: String, required: true, trim: true },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    distanceMeters: { type: Number, default: null, min: 0 },
    status: {
      type: String,
      enum: ['active', 'used', 'expired'],
      default: 'active',
      index: true,
    },
    votesUsed: { type: Number, default: 0, min: 0 },
    maxVotes: { type: Number, default: 2, min: 1 },
    closedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

VisitSchema.index({ business: 1, deviceId: 1, status: 1 });
VisitSchema.index({ business: 1, deviceId: 1, createdAt: -1 });
VisitSchema.index({ user: 1, status: 1, expiresAt: 1 });
VisitSchema.index(
  { business: 1, deviceId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
VisitSchema.index(
  { business: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active', user: { $ne: null } },
  },
);

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: '' },
    googleId: { type: String, unique: true, sparse: true },
    avatar: { type: String, default: '' },
    authProvider: {
      type: String,
      enum: ['password', 'google'],
      default: 'password',
    },
    lastLoginAt: { type: Date, default: null },
    favorites: { type: [String], default: [] },
    points: { type: Number, default: 0, min: 0 },
    role: {
      type: String,
      enum: ['admin', 'business', 'client'],
      required: true,
      index: true,
    },
    business: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended'],
      default: 'active',
    },
  },
  { timestamps: true },
);

const BusinessRequestSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, required: true, trim: true },
    categoryKey: { type: String, required: true },
    categoryOther: { type: String, default: '', trim: true },
    zone: { type: String, default: '' },
    municipality: { type: String, default: '', trim: true },
    parish: { type: String, default: '', trim: true },
    sector: { type: String, default: '', trim: true },
    address: { type: String, required: true },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    hasDelivery: { type: Boolean, default: false },
    coverImage: { type: String, default: '' },
    terms: {
      acceptedAt: { type: Date, default: null },
      version: { type: String, default: '' },
    },
    description: { type: String, default: '' },
    hours: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    notes: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const RankingSnapshotSchema = new Schema(
  {
    period: { type: String, required: true, index: true },
    categoryKey: { type: String, required: true, index: true },
    rankings: [
      {
        position: Number,
        product: { type: Schema.Types.ObjectId, ref: 'Product' },
        business: { type: Schema.Types.ObjectId, ref: 'Business' },
        productName: String,
        businessName: String,
        score: Number,
        ratingsCount: Number,
      },
    ],
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

RankingSnapshotSchema.index({ period: 1, categoryKey: 1 }, { unique: true });

const PromotionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    note: { type: String, default: '' },
    badge: { type: String, default: 'Oferta' },
    emoji: { type: String, default: '🍽️' },
    tone: {
      type: String,
      enum: ['accent', 'amber', 'green'],
      default: 'accent',
    },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: null },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    isActive: { type: Boolean, default: true, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const AppConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    scanRadiusMeters: { type: Number, default: 15, min: 1, max: 500 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const Category = models.Category || model('Category', CategorySchema);
export const Business = models.Business || model('Business', BusinessSchema);
export const Product = models.Product || model('Product', ProductSchema);
export const Rating = models.Rating || model('Rating', RatingSchema);
export const BusinessEvent =
  models.BusinessEvent || model('BusinessEvent', BusinessEventSchema);
export const Achievement =
  models.Achievement || model('Achievement', AchievementSchema);
export const UserAchievement =
  models.UserAchievement || model('UserAchievement', UserAchievementSchema);
export const Coupon = models.Coupon || model('Coupon', CouponSchema);
export const CouponPurchase =
  models.CouponPurchase || model('CouponPurchase', CouponPurchaseSchema);
export const PointTransaction =
  models.PointTransaction || model('PointTransaction', PointTransactionSchema);
export const Visit = models.Visit || model('Visit', VisitSchema);
export const User = models.User || model('User', UserSchema);
export const BusinessRequest =
  models.BusinessRequest || model('BusinessRequest', BusinessRequestSchema);
export const RankingSnapshot =
  models.RankingSnapshot || model('RankingSnapshot', RankingSnapshotSchema);
export const Promotion =
  models.Promotion || model('Promotion', PromotionSchema);
export const AppConfig =
  models.AppConfig || model('AppConfig', AppConfigSchema);
