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
public class ProductService {

    private final ObjectMapper objectMapper;
    private final Map<String, ProductResponse> productsById = new HashMap<>();

    public ProductService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void loadProducts() throws IOException {
        try (InputStream inputStream = new ClassPathResource("mock-data/products.json").getInputStream()) {
            List<ProductResponse> products =
                    objectMapper.readValue(inputStream, new TypeReference<List<ProductResponse>>() {});
            for (ProductResponse product : products) {
                productsById.put(product.productId(), product);
            }
        }
    }

    public ProductResponse getProduct(String productId) {
        ProductResponse product = productsById.get(productId);
        if (product == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown productId: " + productId);
        }
        return product;
    }
}
