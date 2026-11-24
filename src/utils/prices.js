export const PRICE_KEYS = ['unique', 'small', 'medium', 'large'];

/** Cantidad máxima de platos activos por menú en esta primera fase. */
export const MAX_PRODUCTS_PER_MENU = 5;

export function normalizePrices(input = {}) {
  const result = {};
  for (const key of PRICE_KEYS) {
    const raw = input?.[key];
    if (raw === undefined || raw === null || raw === '') {
      result[key] = null;
      continue;
    }
    const value = Number(raw);
    result[key] = Number.isFinite(value) && value > 0 ? value : null;
  }
  return result;
}

export function hasAnyPrice(prices) {
  return PRICE_KEYS.some(
    (key) => typeof prices?.[key] === 'number' && prices[key] > 0,
  );
}

export function hasUniquePrice(prices) {
  return typeof prices?.unique === 'number' && prices.unique > 0;
}

export function hasSizePrices(prices) {
  return ['small', 'medium', 'large'].some(
    (key) => typeof prices?.[key] === 'number' && prices[key] > 0,
  );
}

export function lowestPrice(prices) {
  const values = PRICE_KEYS.map((key) => prices?.[key]).filter(
    (value) => typeof value === 'number' && value > 0,
  );
  return values.length ? Math.min(...values) : null;
}

/**
 * Devuelve los precios de un producto. Los productos antiguos que solo tienen
 * `price` se interpretan como precio de tamaño único.
 */
export function getProductPrices(product) {
  const stored = normalizePrices(product?.prices || {});
  if (hasAnyPrice(stored)) return stored;

  const legacyPrice = Number(product?.price);
  return {
    unique: Number.isFinite(legacyPrice) && legacyPrice > 0 ? legacyPrice : null,
    small: null,
    medium: null,
    large: null,
  };
}

export function validatePricesInput(input) {
  if (!input || typeof input !== 'object') {
    return { error: 'Los precios del plato no son válidos.' };
  }

  for (const key of PRICE_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return { error: 'Cada precio indicado debe ser un número mayor que cero.' };
    }
  }

  const prices = normalizePrices(input);
  if (hasUniquePrice(prices) && hasSizePrices(prices)) {
    return {
      error:
        'Usa el precio de tamaño único o los precios por tamaño (P/M/G), no ambos.',
    };
  }
  if (!hasAnyPrice(prices)) {
    return { error: 'Indica al menos un precio para el plato.' };
  }

  return { prices, price: lowestPrice(prices) };
}
