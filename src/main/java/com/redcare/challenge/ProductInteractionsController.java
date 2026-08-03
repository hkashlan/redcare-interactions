package com.redcare.challenge;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ProductInteractionsController {

    private final ProductService productService;
    private final IngredientService ingredientService;
    private final InteractionService interactionService;

    public ProductInteractionsController(
            ProductService productService,
            IngredientService ingredientService,
            InteractionService interactionService) {
        this.productService = productService;
        this.ingredientService = ingredientService;
        this.interactionService = interactionService;
    }

    @GetMapping("/product")
    public ProductResponse getProduct(@RequestParam String productId) {
        return productService.getProduct(productId);
    }

    @GetMapping("/ingredients")
    public IngredientsResponse getIngredients(@RequestParam String productId) {
        return ingredientService.getIngredients(productId);
    }

    @GetMapping("/interactions")
    public InteractionsResponse getInteractions() {
        return interactionService.getInteractions();
    }
}
