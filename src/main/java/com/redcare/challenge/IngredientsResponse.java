package com.redcare.challenge;

import java.util.List;

public record IngredientsResponse(String productId, List<String> ingredientIds) {}
