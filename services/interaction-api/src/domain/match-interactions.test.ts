import { describe, expect, it } from 'vitest';
import type { CatalogEntry, ProductIngredients } from './match-interactions';
import { matchInteractions } from './match-interactions';

// Fixtures mirror the mock-service data shapes (see services/mock-service mock-data).
const ibuAlcohol: CatalogEntry = {
  interactionId: 'int-ibu-alcohol',
  requiredIngredientIds: ['ing-ibu-001'],
  interactionTexts: ['Ibuprofen and alcohol warning.', 'Second advisory line.'],
};

const ibuAsa: CatalogEntry = {
  interactionId: 'int-ibu-asa',
  requiredIngredientIds: ['ing-ibu-001', 'ing-asa-002'],
  interactionTexts: ['NSAID pair warning.'],
};

const warfarinIbu: CatalogEntry = {
  interactionId: 'int-warfarin-ibu',
  requiredIngredientIds: ['ing-war-005', 'ing-ibu-001'],
  interactionTexts: ['Bleeding risk warning.'],
};

const catalog: CatalogEntry[] = [ibuAlcohol, ibuAsa, warfarinIbu];

const ibuProduct: ProductIngredients = {
  productId: '04114918',
  ingredientIds: ['ing-ibu-001', 'ing-exc-010'],
};

const asaProduct: ProductIngredients = {
  productId: '10019621',
  ingredientIds: ['ing-asa-002', 'ing-exc-010'],
};

const warfarinProduct: ProductIngredients = {
  productId: '06313728',
  ingredientIds: ['ing-war-005'],
};

const emptyProduct: ProductIngredients = {
  productId: '99999999',
  ingredientIds: [],
};

describe('matchInteractions', () => {
  it('matches a single-ingredient interaction via one product', () => {
    const result = matchInteractions(catalog, [ibuProduct]);

    expect(result.map((m) => m.interactionId)).toEqual(['int-ibu-alcohol']);
  });

  it('matches a pair interaction when both ingredients come from different products', () => {
    const result = matchInteractions(catalog, [ibuProduct, asaProduct]);

    expect(result.map((m) => m.interactionId)).toEqual(['int-ibu-alcohol', 'int-ibu-asa']);
  });

  it('does not match a pair interaction when only one side is present', () => {
    const result = matchInteractions(catalog, [asaProduct]);

    expect(result).toEqual([]);
  });

  it('matches a pair interaction when one product contains both ingredients', () => {
    const combinedProduct: ProductIngredients = {
      productId: '11111111',
      ingredientIds: ['ing-ibu-001', 'ing-asa-002'],
    };

    const result = matchInteractions(catalog, [combinedProduct]);

    expect(result.map((m) => m.interactionId)).toContain('int-ibu-asa');
  });

  it('returns no matches for a product with no ingredients', () => {
    const result = matchInteractions(catalog, [emptyProduct]);

    expect(result).toEqual([]);
  });

  it('ignores ingredients that appear in no interaction (shared excipient)', () => {
    // ing-exc-010 is in both products but in no catalog entry: it must not
    // produce a match on its own.
    const excOnly: ProductIngredients = { productId: '22222222', ingredientIds: ['ing-exc-010'] };

    const result = matchInteractions(catalog, [excOnly]);

    expect(result).toEqual([]);
  });

  it('handles duplicate products without duplicating matches', () => {
    const result = matchInteractions(catalog, [ibuProduct, ibuProduct]);

    expect(result.map((m) => m.interactionId)).toEqual(['int-ibu-alcohol']);
    expect(result[0]?.involvedProductIds).toEqual(['04114918']);
  });

  it('returns an empty result for an empty basket', () => {
    expect(matchInteractions(catalog, [])).toEqual([]);
  });

  it('computes involved products and ingredients for a pair interaction', () => {
    const result = matchInteractions(catalog, [warfarinProduct, ibuProduct]);

    const pair = result.find((m) => m.interactionId === 'int-warfarin-ibu');
    expect(pair).toBeDefined();
    expect(pair?.involvedIngredientIds).toEqual(['ing-war-005', 'ing-ibu-001']);
    // Order follows the input basket order.
    expect(pair?.involvedProductIds).toEqual(['06313728', '04114918']);
  });

  it('passes interaction texts through verbatim', () => {
    const result = matchInteractions(catalog, [ibuProduct]);

    expect(result[0]?.texts).toEqual(['Ibuprofen and alcohol warning.', 'Second advisory line.']);
  });

  it('lists only products that contribute a required ingredient as involved', () => {
    const result = matchInteractions(catalog, [ibuProduct, emptyProduct]);

    expect(result.map((m) => m.interactionId)).toEqual(['int-ibu-alcohol']);
    expect(result[0]?.involvedProductIds).toEqual(['04114918']);
  });
});
