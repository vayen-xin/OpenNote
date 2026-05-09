package com.opennote.backend.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.opennote.backend.model.Attempt;
import com.opennote.backend.model.Bank;
import com.opennote.backend.model.Chapter;
import com.opennote.backend.model.DoodleNote;
import com.opennote.backend.model.DoodlePoint;
import com.opennote.backend.model.DoodleStroke;
import com.opennote.backend.model.Question;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Repository
public class InMemoryStore {
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public InMemoryStore(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public List<Bank> banks() {
        return jdbcTemplate.query(
                "SELECT id, name, description FROM question_bank WHERE is_active = 1 ORDER BY id",
                (rs, rowNum) -> new Bank(rs.getLong("id"), rs.getString("name"), rs.getString("description"))
        );
    }

    public List<Chapter> chaptersByBank(Long bankId) {
        return jdbcTemplate.query(
                "SELECT id, bank_id, title, sort_no FROM chapter WHERE bank_id = ? ORDER BY sort_no",
                chapterRowMapper(), bankId
        );
    }

    public Optional<Chapter> chapter(Long chapterId) {
        List<Chapter> rows = jdbcTemplate.query(
                "SELECT id, bank_id, title, sort_no FROM chapter WHERE id = ?",
                chapterRowMapper(), chapterId
        );
        return rows.stream().findFirst();
    }

    public List<Question> questionsByBank(Long bankId) {
        return jdbcTemplate.query(
                "SELECT id, bank_id, chapter_id, type, stem, options_json, correct_answer_json, explanation, sort_no " +
                        "FROM question WHERE bank_id = ? AND is_active = 1 ORDER BY id",
                questionRowMapper(), bankId
        );
    }

    public List<Question> questionsByChapter(Long chapterId) {
        return jdbcTemplate.query(
                "SELECT id, bank_id, chapter_id, type, stem, options_json, correct_answer_json, explanation, sort_no " +
                        "FROM question WHERE chapter_id = ? AND is_active = 1 ORDER BY sort_no",
                questionRowMapper(), chapterId
        );
    }

    public Optional<Question> question(Long questionId) {
        List<Question> rows = jdbcTemplate.query(
                "SELECT id, bank_id, chapter_id, type, stem, options_json, correct_answer_json, explanation, sort_no " +
                        "FROM question WHERE id = ? AND is_active = 1",
                questionRowMapper(), questionId
        );
        return rows.stream().findFirst();
    }

    public long createQuestionBank(String name, String description) {
        long id = nextId("question_bank");
        jdbcTemplate.update(
                "INSERT INTO question_bank(id, name, description) VALUES (?, ?, ?)",
                id, name, description
        );
        return id;
    }

    public long createChapter(Long bankId, String title, int sortNo) {
        long id = nextId("chapter");
        jdbcTemplate.update(
                "INSERT INTO chapter(id, bank_id, title, sort_no) VALUES (?, ?, ?, ?)",
                id, bankId, title, sortNo
        );
        return id;
    }

    public long createManualQuestion(Long bankId, Long chapterId, String stem, String answer, int sortNo) {
        long id = nextId("question");
        jdbcTemplate.update(
                "INSERT INTO question(id, bank_id, chapter_id, type, stem, options_json, correct_answer_json, explanation, sort_no) " +
                        "VALUES (?, ?, ?, 'fill', ?, NULL, CAST('[]' AS JSON), ?, ?)",
                id, bankId, chapterId, stem, answer, sortNo
        );
        return id;
    }

    public Attempt saveAttempt(Long questionId, Object answer, String status) {
        String answerJson = toJsonString(answer);
        jdbcTemplate.update(
                "INSERT INTO question_attempt(user_id, question_id, answer_json, status) " +
                        "VALUES (1, ?, CAST(? AS JSON), ?) " +
                        "ON DUPLICATE KEY UPDATE answer_json = VALUES(answer_json), status = VALUES(status), updated_at = CURRENT_TIMESTAMP",
                questionId, answerJson, status
        );
        return attempt(questionId).orElse(new Attempt(questionId, answer, status, OffsetDateTime.now()));
    }

    public Optional<Attempt> attempt(Long questionId) {
        List<Attempt> rows = jdbcTemplate.query(
                "SELECT question_id, answer_json, status, updated_at FROM question_attempt " +
                        "WHERE user_id = 1 AND question_id = ?",
                (rs, rowNum) -> new Attempt(
                        rs.getLong("question_id"),
                        parseAnswer(rs.getString("answer_json")),
                        rs.getString("status"),
                        toOffsetDateTime(rs.getTimestamp("updated_at"))
                ),
                questionId
        );
        return rows.stream().findFirst();
    }

    public DoodleNote saveDoodle(Long questionId, String layer, DoodleNote note) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id FROM doodle_note WHERE user_id = 1 AND question_id = ? AND layer = ?",
                questionId, layer
        );
        long noteId;
        if (rows.isEmpty()) {
            jdbcTemplate.update(
                    "INSERT INTO doodle_note(user_id, question_id, layer, layout_version, base_width, base_height, font_scale) " +
                            "VALUES (1, ?, ?, ?, ?, ?, ?)",
                    questionId, layer, note.layoutVersion(), note.baseWidth(), note.baseHeight(), note.fontScale()
            );
            noteId = jdbcTemplate.queryForObject(
                    "SELECT id FROM doodle_note WHERE user_id = 1 AND question_id = ? AND layer = ?",
                    Long.class, questionId, layer
            );
        } else {
            noteId = ((Number) rows.get(0).get("id")).longValue();
            jdbcTemplate.update(
                    "UPDATE doodle_note SET layout_version = ?, base_width = ?, base_height = ?, font_scale = ?, updated_at = CURRENT_TIMESTAMP " +
                            "WHERE id = ?",
                    note.layoutVersion(), note.baseWidth(), note.baseHeight(), note.fontScale(), noteId
            );
            jdbcTemplate.update("DELETE FROM doodle_stroke WHERE note_id = ?", noteId);
        }

        for (DoodleStroke stroke : note.strokes()) {
            jdbcTemplate.update(
                    "INSERT INTO doodle_stroke(note_id, seq_no, tool, color, width, points_json) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))",
                    noteId, stroke.seqNo(), stroke.tool(), stroke.color(), stroke.width(), toJsonString(stroke.points())
            );
        }
        return doodle(questionId, layer).orElse(note);
    }

    public Optional<DoodleNote> doodle(Long questionId, String layer) {
        List<Map<String, Object>> notes = jdbcTemplate.queryForList(
                "SELECT id, question_id, layer, layout_version, base_width, base_height, font_scale " +
                        "FROM doodle_note WHERE user_id = 1 AND question_id = ? AND layer = ?",
                questionId, layer
        );
        if (notes.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> note = notes.get(0);
        long noteId = ((Number) note.get("id")).longValue();
        List<DoodleStroke> strokes = jdbcTemplate.query(
                "SELECT seq_no, tool, color, width, points_json FROM doodle_stroke WHERE note_id = ? ORDER BY seq_no",
                (rs, rowNum) -> new DoodleStroke(
                        rs.getInt("seq_no"),
                        rs.getString("tool"),
                        rs.getString("color"),
                        rs.getDouble("width"),
                        parsePoints(rs.getString("points_json"))
                ),
                noteId
        );
        return Optional.of(new DoodleNote(
                ((Number) note.get("question_id")).longValue(),
                String.valueOf(note.get("layer")),
                ((Number) note.get("layout_version")).intValue(),
                ((Number) note.get("base_width")).intValue(),
                ((Number) note.get("base_height")).intValue(),
                ((Number) note.get("font_scale")).doubleValue(),
                strokes
        ));
    }

    public ProgressSummary progress(Long bankId) {
        List<Question> bankQuestions = questionsByBank(bankId);
        int total = bankQuestions.size();
        Set<Long> ids = bankQuestions.stream().map(Question::id).collect(Collectors.toSet());

        List<Attempt> bankAttempts = bankQuestions.stream()
                .map(Question::id)
                .map(this::attempt)
                .filter(Optional::isPresent)
                .map(Optional::get)
                .toList();

        int done = bankAttempts.size();
        int correct = (int) bankAttempts.stream().filter(a -> "correct".equals(a.status())).count();
        int wrong = (int) bankAttempts.stream().filter(a -> "wrong".equals(a.status())).count();
        double accuracy = done == 0 ? 0.0 : (correct * 100.0 / done);

        List<ChapterProgress> chapterProgress = chaptersByBank(bankId).stream().map(ch -> {
            List<Question> cqs = questionsByChapter(ch.id());
            Set<Long> cids = cqs.stream().map(Question::id).collect(Collectors.toSet());
            List<Attempt> cas = bankAttempts.stream().filter(a -> cids.contains(a.questionId())).toList();
            int cDone = cas.size();
            int cCorrect = (int) cas.stream().filter(a -> "correct".equals(a.status())).count();
            double cAccuracy = cDone == 0 ? 0.0 : (cCorrect * 100.0 / cDone);
            return new ChapterProgress(ch.id(), ch.title(), cDone, cqs.size(), cAccuracy);
        }).sorted(Comparator.comparing(ChapterProgress::chapterId)).toList();

        return new ProgressSummary(bankId, done, total, correct, wrong, accuracy, chapterProgress);
    }

    private RowMapper<Chapter> chapterRowMapper() {
        return (rs, rowNum) -> new Chapter(
                rs.getLong("id"),
                rs.getLong("bank_id"),
                rs.getString("title"),
                rs.getInt("sort_no")
        );
    }

    private RowMapper<Question> questionRowMapper() {
        return (rs, rowNum) -> new Question(
                rs.getLong("id"),
                rs.getLong("bank_id"),
                rs.getLong("chapter_id"),
                rs.getString("type"),
                rs.getString("stem"),
                parseOptions(rs.getString("options_json")),
                parseCorrectAnswer(rs.getString("correct_answer_json"), rs.getString("type")),
                rs.getString("explanation"),
                rs.getInt("sort_no")
        );
    }

    private long nextId(String tableName) {
        Long maxId = jdbcTemplate.queryForObject("SELECT COALESCE(MAX(id), 0) FROM " + tableName, Long.class);
        return (maxId == null ? 0 : maxId) + 1;
    }

    private List<String> parseOptions(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return null;
        }
    }

    private Object parseCorrectAnswer(String json, String type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            if ("single_choice".equals(type)) {
                Map<String, Integer> map = objectMapper.readValue(json, new TypeReference<Map<String, Integer>>() {});
                return map.getOrDefault("index", 0);
            }
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return null;
        }
    }

    private Object parseAnswer(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            return json;
        }
    }

    private List<DoodlePoint> parsePoints(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<DoodlePoint>>() {});
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    private String toJsonString(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return "null";
        }
    }

    private OffsetDateTime toOffsetDateTime(Timestamp timestamp) {
        if (timestamp == null) {
            return OffsetDateTime.now();
        }
        return timestamp.toInstant().atOffset(ZoneOffset.ofHours(8));
    }

    public record ProgressSummary(
            Long bankId,
            int done,
            int total,
            int correct,
            int wrong,
            double accuracy,
            List<ChapterProgress> chapters
    ) {
    }

    public record ChapterProgress(Long chapterId, String chapterTitle, int done, int total, double accuracy) {
    }
}
