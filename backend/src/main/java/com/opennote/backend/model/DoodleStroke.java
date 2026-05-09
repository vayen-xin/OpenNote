package com.opennote.backend.model;

import java.util.List;

public record DoodleStroke(
        int seqNo,
        String tool,
        String color,
        double width,
        List<DoodlePoint> points
) {
}
