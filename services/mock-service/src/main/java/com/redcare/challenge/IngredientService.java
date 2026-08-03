package com.redcare.challenge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class IngredientService {

    private final ObjectMapper objectMapper;
    private final Map<String, IngredientsResponse> ingredientsByProductId = new HashMap<>();

    public IngredientService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void loadIngredients() throws IOException {
        try (InputStream inputStream = new ClassPathResource("mock-data/ingredients.json").getInputStream()) {
            List<IngredientsResponse> products =
                    objectMapper.readValue(inputStream, new TypeReference<List<IngredientsResponse>>() {});
            for (IngredientsResponse product : products) {
                ingredientsByProductId.put(product.productId(), product);
            }
        }
    }

    public IngredientsResponse getIngredients(String productId) {
        IngredientsResponse ingredients = ingredientsByProductId.get(productId);
        if (ingredients == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown productId: " + productId);
        }
        return ingredients;
    }
}
