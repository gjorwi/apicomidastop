import {
  Achievement,
  CouponPurchase,
  PointTransaction,
  Product,
  Rating,
  User,
  UserAchievement,
} from '../models/index.js';

export const POINTS_WELCOME = 10;
export const POINTS_FIRST_BUSINESS_RATING = 20;
export const POINTS_RATING = 10;

export const ACHIEVEMENT_REQUIREMENT_LABELS = {
  ratings_count: 'Puntuaciones realizadas',
  categories_count: 'Categorías distintas',
  businesses_count: 'Negocios distintos',
  active_days: 'Días con actividad',
  coupons_acquired: 'Cupones adquiridos',
  coupons_used: 'Cupones usados',
};

function caracasDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

export function getCaracasDayBounds(date = new Date()) {
  const shifted = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const start = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      4,
      0,
      0,
      0,
    ),
  );
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

async function creditPoints({
  userId,
  amount,
  type,
  business = null,
  rating = null,
  achievement = null,
  purchase = null,
  description = '',
}) {
  if (!amount) return null;

  try {
    await PointTransaction.create({
      user: userId,
      amount,
      type,
      business,
      rating,
      achievement,
      purchase,
      description,
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }

  return User.findByIdAndUpdate(
    userId,
    { $inc: { points: amount } },
    { new: true },
  );
}

export async function awardWelcomePoints(userId) {
  return creditPoints({
    userId,
    amount: POINTS_WELCOME,
    type: 'welcome',
    description: 'Bienvenida a comidasTop',
  });
}

export async function awardRatingPoints({
  userId,
  businessId,
  ratingId,
  firstBusinessRating,
}) {
  const amount = firstBusinessRating
    ? POINTS_FIRST_BUSINESS_RATING
    : POINTS_RATING;

  let user = await creditPoints({
    userId,
    amount,
    type: firstBusinessRating ? 'rating_first_business' : 'rating',
    business: businessId,
    rating: ratingId,
    description: firstBusinessRating
      ? 'Primera puntuación en este negocio'
      : 'Puntuación de un plato',
  });

  if (!user && firstBusinessRating) {
    user = await creditPoints({
      userId,
      amount: POINTS_RATING,
      type: 'rating',
      business: businessId,
      rating: ratingId,
      description: 'Puntuación de un plato',
    });
  }

  return { user, pointsEarned: amount };
}

async function achievementProgress(achievement, userId) {
  const since = achievement.createdAt;

  switch (achievement.requirementType) {
    case 'ratings_count': {
      return Rating.countDocuments({
        user: userId,
        createdAt: { $gte: since },
      });
    }
    case 'categories_count': {
      const productIds = await Rating.distinct('product', {
        user: userId,
        createdAt: { $gte: since },
      });
      if (!productIds.length) return 0;
      const categories = await Product.distinct('categoryKey', {
        _id: { $in: productIds },
      });
      return categories.length;
    }
    case 'businesses_count': {
      const businesses = await Rating.distinct('business', {
        user: userId,
        createdAt: { $gte: since },
      });
      return businesses.length;
    }
    case 'active_days': {
      const ratings = await Rating.find({
        user: userId,
        createdAt: { $gte: since },
      })
        .select('createdAt')
        .lean();
      return new Set(ratings.map((rating) => caracasDayKey(rating.createdAt)))
        .size;
    }
    case 'coupons_acquired': {
      return CouponPurchase.countDocuments({
        user: userId,
        acquiredAt: { $gte: since },
      });
    }
    case 'coupons_used': {
      return CouponPurchase.countDocuments({
        user: userId,
        status: 'used',
        acceptedAt: { $gte: since },
      });
    }
    default:
      return 0;
  }
}

export async function evaluateAchievements(userId) {
  const achievements = await Achievement.find({ isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .lean();
  if (!achievements.length) return [];

  const now = new Date();
  const unlocked = [];

  for (const achievement of achievements) {
    const count = await achievementProgress(achievement, userId);
    const progress = Math.min(count, achievement.requirementValue);

    const record = await UserAchievement.findOneAndUpdate(
      { user: userId, achievement: achievement._id },
      {
        $max: { progress },
        $setOnInsert: { user: userId, achievement: achievement._id },
      },
      { upsert: true, new: true },
    );

    if (!record.unlockedAt && count >= achievement.requirementValue) {
      const claimed = await UserAchievement.findOneAndUpdate(
        { user: userId, achievement: achievement._id, unlockedAt: null },
        { $set: { progress, unlockedAt: now, rewardGrantedAt: now } },
        { new: true },
      );

      if (claimed) {
        if (achievement.rewardPoints > 0) {
          await creditPoints({
            userId,
            amount: achievement.rewardPoints,
            type: 'achievement',
            achievement: achievement._id,
            description: `Logro: ${achievement.title}`,
          });
        }
        unlocked.push({
          id: String(achievement._id),
          code: achievement.code,
          title: achievement.title,
          icon: achievement.icon,
          rewardPoints: achievement.rewardPoints,
        });
      }
    }
  }

  return unlocked;
}

export async function getPointsSummary(userId) {
  const [user, history] = await Promise.all([
    User.findById(userId).select('points').lean(),
    PointTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  return {
    points: user?.points || 0,
    history: history.map((transaction) => ({
      id: String(transaction._id),
      type: transaction.type,
      amount: transaction.amount,
      description: transaction.description,
      createdAt: transaction.createdAt,
    })),
  };
}

export async function getAchievementsForUser(userId) {
  const [achievements, userAchievements] = await Promise.all([
    Achievement.find({ isActive: true }).sort({ order: 1, createdAt: 1 }).lean(),
    UserAchievement.find({ user: userId }).lean(),
  ]);
  const unlockedMap = new Map(
    userAchievements.map((item) => [String(item.achievement), item]),
  );

  return achievements.map((achievement) => {
    const record = unlockedMap.get(String(achievement._id));
    return {
      id: String(achievement._id),
      code: achievement.code,
      title: achievement.title,
      description: achievement.description,
      icon: achievement.icon,
      requirementType: achievement.requirementType,
      requirementValue: achievement.requirementValue,
      rewardPoints: achievement.rewardPoints,
      progress: record?.progress || 0,
      unlockedAt: record?.unlockedAt || null,
    };
  });
}

export { creditPoints };
