package com.opennote.backend.service;

import com.opennote.backend.model.Attempt;
import com.opennote.backend.model.Bank;
import com.opennote.backend.model.Chapter;
import com.opennote.backend.model.DoodleNote;
import com.opennote.backend.model.Question;
import com.opennote.backend.repository.InMemoryStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

@Service
public class OpenNoteService {
    private final InMemoryStore store;

    public OpenNoteService(InMemoryStore store) {
        this.store = store;
    }

    public List<Bank> listBanks() {
        return store.banks();
    }

    public List<ChapterDto> listChapters(Long bankId) {
        validateBank(bankId);
        return store.chaptersByBank(bankId).stream().map(ch -> {
            int total = store.questionsByChapter(ch.id()).size();
            int done = (int) store.questionsByChapter(ch.id()).stream()
                    .map(Question::id)
                    .map(store::attempt)
                    .filter(Optional::isPresent)
                    .map(Optional::get)
                    .filter(a -> !"unanswered".equals(a.status()))
                    .count();
            int correct = (int) store.questionsByChapter(ch.id()).stream()
                    .map(Question::id)
                    .map(store::attempt)
                    .filter(Optional::isPresent)
                    .map(Optional::get)
                    .filter(a -> "correct".equals(a.status()))
                    .count();
            double accuracy = done == 0 ? 0 : (correct * 100.0 / done);
            return new ChapterDto(ch.id(), ch.bankId(), ch.title(), ch.sortNo(), total, done, accuracy);
        }).toList();
    }

    public List<QuestionDto> listQuestions(Long bankId) {
        validateBank(bankId);
        return store.questionsByBank(bankId).stream().map(q -> {
            Attempt attempt = store.attempt(q.id()).orElse(null);
            Integer selectedAnswerIndex = null;
            if (attempt != null && attempt.answer() instanceof Number num) {
                selectedAnswerIndex = num.intValue();
            }
            String status = attempt == null ? "unanswered" : attempt.status();
            String chapterTitle = store.chapter(q.chapterId()).map(Chapter::title).orElse("");
            return new QuestionDto(
                    q.id(),
                    q.bankId(),
                    q.chapterId(),
                    chapterTitle,
                    q.sortNo(),
                    q.type(),
                    q.stem(),
                    q.options(),
                    q.explanation(),
                    status,
                    selectedAnswerIndex
            );
        }).toList();
    }

    public List<QuestionListItemDto> listQuestionIndex(Long bankId) {
        validateBank(bankId);
        return store.questionsByBank(bankId).stream().map(q -> {
            Attempt attempt = store.attempt(q.id()).orElse(null);
            Integer selectedAnswerIndex = null;
            if (attempt != null && attempt.answer() instanceof Number num) {
                selectedAnswerIndex = num.intValue();
            }
            String status = attempt == null ? "unanswered" : attempt.status();
            String chapterTitle = store.chapter(q.chapterId()).map(Chapter::title).orElse("");
            return new QuestionListItemDto(
                    q.id(),
                    q.bankId(),
                    q.chapterId(),
                    chapterTitle,
                    q.sortNo(),
                    q.type(),
                    status,
                    selectedAnswerIndex
            );
        }).toList();
    }

    public QuestionDto getQuestionDetail(Long questionId) {
        Question q = getQuestion(questionId);
        Attempt attempt = store.attempt(q.id()).orElse(null);
        Integer selectedAnswerIndex = null;
        if (attempt != null && attempt.answer() instanceof Number num) {
            selectedAnswerIndex = num.intValue();
        }
        String status = attempt == null ? "unanswered" : attempt.status();
        String chapterTitle = store.chapter(q.chapterId()).map(Chapter::title).orElse("");
        return new QuestionDto(
                q.id(),
                q.bankId(),
                q.chapterId(),
                chapterTitle,
                q.sortNo(),
                q.type(),
                q.stem(),
                q.options(),
                q.explanation(),
                status,
                selectedAnswerIndex
        );
    }

    public Question getQuestion(Long questionId) {
        return store.question(questionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "题目不存在"));
    }

    public Attempt submitAttempt(Long questionId, Object answer, String status) {
        getQuestion(questionId);
        String finalStatus = normalizeStatus(status, answer);
        return store.saveAttempt(questionId, answer, finalStatus);
    }

    public InMemoryStore.ProgressSummary progress(Long bankId) {
        validateBank(bankId);
        return store.progress(bankId);
    }

    public DoodleNote getDoodle(Long questionId, String layer) {
        getQuestion(questionId);
        return store.doodle(questionId, layer)
                .orElse(new DoodleNote(questionId, layer, 1, 1200, 600, 1.0, List.of()));
    }

    public DoodleNote saveDoodle(Long questionId, String layer, DoodleNote note) {
        getQuestion(questionId);
        return store.saveDoodle(questionId, layer, note);
    }

    private void validateBank(Long bankId) {
        boolean exists = store.banks().stream().anyMatch(b -> b.id().equals(bankId));
        if (!exists) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "题库不存在");
        }
    }

    private String normalizeStatus(String status, Object answer) {
        if (status == null || status.isBlank()) {
            if (answer == null) {
                return "unanswered";
            }
            String val = String.valueOf(answer).trim();
            return val.isEmpty() ? "unanswered" : "pending_review";
        }
        return switch (status) {
            case "unanswered", "pending_review", "correct", "wrong" -> status;
            default -> "pending_review";
        };
    }

    public record ChapterDto(
            Long id,
            Long bankId,
            String title,
            int sortNo,
            int totalQuestions,
            int completedQuestions,
            double accuracy
    ) {
    }

    public record QuestionListItemDto(
            Long id,
            Long bankId,
            Long chapterId,
            String chapterTitle,
            int sortNo,
            String type,
            String status,
            Integer selectedAnswerIndex
    ) {
    }

    public record QuestionDto(
            Long id,
            Long bankId,
            Long chapterId,
            String chapterTitle,
            int sortNo,
            String type,
            String stem,
            List<String> options,
            String explanation,
            String status,
            Integer selectedAnswerIndex
    ) {
    }
}
