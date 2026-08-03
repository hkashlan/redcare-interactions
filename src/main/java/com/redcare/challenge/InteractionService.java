package com.redcare.challenge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

@Service
public class InteractionService {

    private final ObjectMapper objectMapper;
    private final List<IngredientInteractionData> interactions = new ArrayList<>();

    public InteractionService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void loadInteractions() throws IOException {
        try (InputStream inputStream = new ClassPathResource("mock-data/interactions.json").getInputStream()) {
            List<IngredientInteractionData> interactionData =
                    objectMapper.readValue(inputStream, new TypeReference<List<IngredientInteractionData>>() {});
            validateInteractions(interactionData);
            interactions.clear();
            interactions.addAll(interactionData);
        }
    }

    public InteractionsResponse getInteractions() {
        return new InteractionsResponse(List.copyOf(interactions));
    }

    private void validateInteractions(List<IngredientInteractionData> interactionData) {
        for (IngredientInteractionData interaction : interactionData) {
            int requiredIngredientCount = interaction.requiredIngredientIds().size();
            if (requiredIngredientCount < 1 || requiredIngredientCount > 2) {
                throw new IllegalStateException("Interaction %s must require one or two ingredients, but requires %d"
                        .formatted(interaction.interactionId(), requiredIngredientCount));
            }
        }
    }
}
