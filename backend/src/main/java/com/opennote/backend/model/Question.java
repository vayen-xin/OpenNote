package com.opennote.backend.model;

import java.util.List;

public record Question(
        Long id,
        Long bankId,
        Long chapterId,
        String type,
        String stem,
        List<String> options,
        Object correctAnswer,
        String explanation,
        int sortNo
) {
}
