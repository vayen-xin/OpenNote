package com.opennote.backend.model;

import java.time.OffsetDateTime;

public record Attempt(
        Long questionId,
        Object answer,
        String status,
        OffsetDateTime updatedAt
) {
}
