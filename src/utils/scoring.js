const BAYESIAN_PRIOR_WEIGHT = 10;
export const MIN_RATINGS_FOR_RANKING = 5;
const RATING_WINDOW_DAYS = 365;

export function getPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

export function periodLabel(period) {
  if (!period) return '';
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('es-VE', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

export function recencyWeight(date, now = new Date()) {
  const ageMs = now.getTime() - new Date(date).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days <= 90) return 1;
  if (days <= 365) return 0.5;
  return 0.25;
}

export function computeProductMetrics(product, ratings = [], categoryAverage = 4.2) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const validRatings = ratings.filter((rating) => new Date(rating.createdAt) >= windowStart);

  if (!validRatings.length) {
    return {
      averageScore: null,
      score: null,
      ratingsCount: 0,
      totalRatings: ratings.length,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const rating of validRatings) {
    const weight = recencyWeight(rating.createdAt, now);
    weightedSum += rating.score * weight;
    weightTotal += weight;
  }

  const rawAverage = weightedSum / weightTotal;
  const adjustedScore =
    (weightTotal / (weightTotal + BAYESIAN_PRIOR_WEIGHT)) * rawAverage +
    (BAYESIAN_PRIOR_WEIGHT / (weightTotal + BAYESIAN_PRIOR_WEIGHT)) * categoryAverage;

  return {
    averageScore: Number(rawAverage.toFixed(2)),
    score: Number(adjustedScore.toFixed(2)),
    ratingsCount: validRatings.length,
    totalRatings: ratings.length,
  };
}

export function computeBusinessMetrics({
  business,
  products,
  ratings,
  categories,
}) {
  const activeProducts = products.filter((product) => product.isActive !== false);
  const ratingsByProduct = new Map();

  for (const rating of ratings) {
    const key = String(rating.product);
    if (!ratingsByProduct.has(key)) ratingsByProduct.set(key, []);
    ratingsByProduct.get(key).push(rating);
  }

  const categoryMap = new Map(categories.map((category) => [category.key, category]));
  const productMetrics = activeProducts.map((product) => {
    const category = categoryMap.get(product.categoryKey);
    const metrics = computeProductMetrics(
      product,
      ratingsByProduct.get(String(product._id)) || [],
      category?.average ?? 4.2,
    );
    return { product, metrics, category };
  });

  const ratedProducts = productMetrics.filter(
    (item) => item.metrics.score !== null,
  );
  const score = ratedProducts.length
    ? ratedProducts.reduce((total, item) => total + item.metrics.score, 0) /
      ratedProducts.length
    : null;

  const categoryScores = categories
    .map((category) => {
      const items = ratedProducts.filter(
        (item) => item.product.categoryKey === category.key,
      );
      if (!items.length) return null;
      return {
        id: category.key,
        label: category.name,
        score:
          items.reduce((total, item) => total + item.metrics.score, 0) /
          items.length,
        productsCount: items.length,
      };
    })
    .filter(Boolean);

  return {
    score: score === null ? null : Number(score.toFixed(2)),
    ratingsCount: ratedProducts.reduce(
      (total, item) => total + item.metrics.ratingsCount,
      0,
    ),
    ratedProducts: ratedProducts.length,
    activeProducts: activeProducts.length,
    availableProducts: activeProducts.filter((product) => product.isAvailable).length,
    categories: categoryScores,
    productMetrics,
  };
}

export function buildCategoryRanking({
  products,
  ratings,
  categories,
  categoryKey,
}) {
  const category = categories.find((item) => item.key === categoryKey);
  const ratingsByProduct = new Map();
  for (const rating of ratings) {
    const key = String(rating.product);
    if (!ratingsByProduct.has(key)) ratingsByProduct.set(key, []);
    ratingsByProduct.get(key).push(rating);
  }

  return products
    .filter(
      (product) =>
        product.categoryKey === categoryKey && product.isActive !== false,
    )
    .map((product) => {
      const metrics = computeProductMetrics(
        product,
        ratingsByProduct.get(String(product._id)) || [],
        category?.average ?? 4.2,
      );
      return { product, metrics };
    })
    .filter(
      (item) =>
        item.metrics.score !== null &&
        item.metrics.ratingsCount >= MIN_RATINGS_FOR_RANKING,
    )
    .sort(
      (a, b) =>
        b.metrics.score - a.metrics.score ||
        b.metrics.ratingsCount - a.metrics.ratingsCount,
    )
    .map((item, index) => ({
      position: index + 1,
      product: item.product,
      metrics: item.metrics,
    }));
}
