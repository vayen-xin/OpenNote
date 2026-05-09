package com.opennote.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.opennote.backend.repository.InMemoryStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class QuestionImportService {
    private static final String FORMAT = "opennote.import.v1";

    private final InMemoryStore store;
    private final ObjectMapper objectMapper;
    private final Path mediaRoot;

    public QuestionImportService(
            InMemoryStore store,
            ObjectMapper objectMapper,
            @Value("${opennote.media-root:./storage/media}") String mediaRoot
    ) {
        this.store = store;
        this.objectMapper = objectMapper;
        this.mediaRoot = Path.of(mediaRoot).toAbsolutePath().normalize();
    }

    @Transactional
    public ImportResult importPackage(MultipartFile file) {
        ImportBundle bundle = readImportBundle(file);
        return importBundle(bundle);
    }

    @Transactional
    public ImportResult importRunDirectory(Path runDir) {
        Path jsonPath = runDir.resolve("opennote-import.v1.json");
        if (!Files.exists(jsonPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Import result json not found");
        }
        try {
            ImportPayload payload = objectMapper.readValue(jsonPath.toFile(), ImportPayload.class);
            return importBundle(new ImportBundle(payload, Collections.emptyMap(), runDir));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Failed to read import result json", e);
        }
    }

    private ImportResult importBundle(ImportBundle bundle) {
        if (!FORMAT.equals(bundle.payload().format())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported import format");
        }
        if (bundle.payload().bank() == null || isBlank(bundle.payload().bank().name())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bank name is required");
        }

        String packageDir = "question-banks/bank-" + Instant.now().toEpochMilli();
        Map<String, String> mediaUrls = saveMediaFiles(packageDir, bundle);

        long bankId = store.createQuestionBank(
                bundle.payload().bank().name().trim(),
                emptyToNull(bundle.payload().bank().description())
        );

        int chapterCount = 0;
        int questionCount = 0;
        List<String> warnings = new ArrayList<>();

        List<ImportChapter> chapters = safeList(bundle.payload().chapters());
        if (chapters.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "At least one chapter is required");
        }

        for (int ci = 0; ci < chapters.size(); ci += 1) {
            ImportChapter chapter = chapters.get(ci);
            String title = isBlank(chapter.title()) ? "Unchaptered" : chapter.title().trim();
            int chapterSortNo = positiveOrDefault(chapter.sortNo(), ci + 1);
            long chapterId = store.createChapter(bankId, title, chapterSortNo);
            chapterCount += 1;

            List<ImportQuestion> questions = safeList(chapter.questions());
            for (int qi = 0; qi < questions.size(); qi += 1) {
                ImportQuestion question = questions.get(qi);
                String stem = renderBlocks(question.stem(), mediaUrls, warnings, question.externalId());
                String answer = renderBlocks(question.answer(), mediaUrls, warnings, question.externalId());
                if (isBlank(stem)) {
                    warnings.add("Skipped question without stem: " + nullToUnknown(question.externalId()));
                    continue;
                }
                store.createManualQuestion(
                        bankId,
                        chapterId,
                        stem,
                        answer,
                        positiveOrDefault(question.sortNo(), qi + 1)
                );
                questionCount += 1;
            }
        }

        if (bundle.payload().extractionReport() != null && bundle.payload().extractionReport().warnings() != null) {
            warnings.addAll(bundle.payload().extractionReport().warnings());
        }

        return new ImportResult(bankId, chapterCount, questionCount, "/uploads/question-media/" + packageDir, warnings);
    }

    private ImportBundle readImportBundle(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Import file is required");
        }
        String filename = Objects.requireNonNullElse(file.getOriginalFilename(), "").toLowerCase(Locale.ROOT);
        try {
            if (filename.endsWith(".zip")) {
                return readZip(file.getBytes());
            }
            ImportPayload payload = objectMapper.readValue(file.getBytes(), ImportPayload.class);
            return new ImportBundle(payload, Collections.emptyMap(), null);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Failed to read import file", e);
        }
    }

    private ImportBundle readZip(byte[] bytes) throws IOException {
        Map<String, byte[]> entries = new HashMap<>();
        byte[] jsonBytes = null;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                String name = normalizeZipPath(entry.getName());
                byte[] data = zip.readAllBytes();
                entries.put(name, data);
                if (name.endsWith("opennote-import.v1.json")) {
                    jsonBytes = data;
                }
            }
        }
        if (jsonBytes == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "opennote-import.v1.json not found in zip");
        }
        ImportPayload payload = objectMapper.readValue(jsonBytes, ImportPayload.class);
        return new ImportBundle(payload, entries, null);
    }

    private Map<String, String> saveMediaFiles(String packageDir, ImportBundle bundle) {
        Map<String, String> urls = new HashMap<>();
        for (ImportMedia media : safeList(bundle.payload().media())) {
            if (isBlank(media.id()) || isBlank(media.path())) {
                continue;
            }
            String relativePath = normalizeZipPath(media.path());
            Path target = mediaRoot.resolve(packageDir).resolve(relativePath).normalize();
            if (!target.startsWith(mediaRoot)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Illegal media path: " + media.path());
            }
            try {
                Files.createDirectories(target.getParent());
                if (bundle.sourceRoot() != null) {
                    Path source = bundle.sourceRoot().resolve(relativePath).normalize();
                    if (!source.startsWith(bundle.sourceRoot()) || !Files.exists(source)) {
                        continue;
                    }
                    Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
                } else {
                    byte[] bytes = bundle.entries().get(relativePath);
                    if (bytes == null) {
                        continue;
                    }
                    Files.write(target, bytes);
                }
            } catch (IOException e) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to save media file", e);
            }
            urls.put(media.id(), "/uploads/question-media/" + packageDir + "/" + relativePath);
        }
        return urls;
    }

    private String renderBlocks(List<ContentBlock> blocks, Map<String, String> mediaUrls, List<String> warnings, String questionId) {
        List<String> lines = new ArrayList<>();
        for (ContentBlock block : safeList(blocks)) {
            if ("text".equals(block.type())) {
                if (!isBlank(block.text())) {
                    lines.add(block.text().trim());
                }
                continue;
            }
            if ("latex".equals(block.type())) {
                if (!isBlank(block.text())) {
                    lines.add("$$" + block.text().trim() + "$$");
                }
                continue;
            }
            if ("image".equals(block.type())) {
                String alt = isBlank(block.alt()) ? "image" : block.alt().trim();
                String url = block.mediaId() == null ? null : mediaUrls.get(block.mediaId());
                if (url == null) {
                    warnings.add("Missing media for question " + nullToUnknown(questionId) + ": " + nullToUnknown(block.mediaId()));
                    lines.add("[Missing image: " + alt + "]");
                } else {
                    lines.add("![" + alt.replace("]", "") + "](" + url + ")");
                }
            }
        }
        return String.join("\n\n", lines);
    }

    private String normalizeZipPath(String path) {
        String normalized = Normalizer.normalize(path, Normalizer.Form.NFKC).replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        if (normalized.contains("../") || normalized.startsWith("..")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Illegal path: " + path);
        }
        return normalized;
    }

    private int positiveOrDefault(Integer value, int defaultValue) {
        return value == null || value <= 0 ? defaultValue : value;
    }

    private String emptyToNull(String value) {
        return isBlank(value) ? null : value.trim();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String nullToUnknown(Object value) {
        return value == null ? "unknown" : String.valueOf(value);
    }

    private <T> List<T> safeList(List<T> value) {
        return value == null ? Collections.emptyList() : value;
    }

    private record ImportBundle(ImportPayload payload, Map<String, byte[]> entries, Path sourceRoot) {
    }

    public record ImportResult(
            long bankId,
            int chapterCount,
            int questionCount,
            String mediaBaseUrl,
            List<String> warnings
    ) {
    }

    public record ImportPayload(
            String format,
            ImportBank bank,
            List<ImportMedia> media,
            List<ImportChapter> chapters,
            ExtractionReport extractionReport
    ) {
    }

    public record ImportBank(String name, String description) {
    }

    public record ImportMedia(String id, String path, String mimeType, String alt, String sourceRef) {
    }

    public record ImportChapter(String externalId, String title, Integer sortNo, List<ImportQuestion> questions) {
    }

    public record ImportQuestion(
            String externalId,
            String sourceRef,
            Integer sortNo,
            String kind,
            List<ContentBlock> stem,
            List<ContentBlock> answer,
            List<ContentBlock> explanation,
            List<String> tags
    ) {
    }

    public record ContentBlock(String type, String text, String mediaId, String alt, Boolean missing) {
    }

    public record ExtractionReport(String source, List<String> warnings) {
    }
}
