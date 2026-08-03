package com.redcare.challenge;

import java.util.List;

public record IngredientInteractionData(
        String interactionId, List<String> requiredIngredientIds, List<String> interactionTexts) {}
