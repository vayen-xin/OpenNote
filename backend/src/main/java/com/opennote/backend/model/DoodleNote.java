package com.opennote.backend.model;

import java.util.List;

public record DoodleNote(
        Long questionId,
        String layer,
        int layoutVersion,
        int baseWidth,
        int baseHeight,
        double fontScale,
        List<DoodleStroke> strokes
) {
}
