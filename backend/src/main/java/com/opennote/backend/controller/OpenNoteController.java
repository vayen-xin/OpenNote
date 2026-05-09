package com.opennote.backend.controller;

import com.opennote.backend.model.Attempt;
import com.opennote.backend.model.Bank;
import com.opennote.backend.model.DoodleNote;
import com.opennote.backend.model.DoodleStroke;
import com.opennote.backend.model.Question;
import com.opennote.backend.repository.InMemoryStore;
import com.opennote.backend.service.AiImportTaskService;
import com.opennote.backend.service.OpenNoteService;
import com.opennote.backend.service.QuestionImportService;
import org.springframework.validation.annotation.Validated;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api")
@Validated
public class OpenNoteController {
    private final OpenNoteService service;
    private final QuestionImportService importService;
    private final AiImportTaskService aiImportTaskService;

    public OpenNoteController(OpenNoteService service, QuestionImportService importService, AiImportTaskService aiImportTaskService) {
        this.service = service;
        this.importService = importService;
        this.aiImportTaskService = aiImportTaskService;
    }

    @GetMapping("/banks")
    public List<Bank> banks() {
        return service.listBanks();
    }

    @GetMapping("/banks/{bankId}/chapters")
    public List<OpenNoteService.ChapterDto> chapters(@PathVariable Long bankId) {
        return service.listChapters(bankId);
    }

    @GetMapping("/banks/{bankId}/questions")
    public List<OpenNoteService.QuestionDto> questions(@PathVariable Long bankId) {
        return service.listQuestions(bankId);
    }

    @GetMapping("/banks/{bankId}/question-index")
    public List<OpenNoteService.QuestionListItemDto> questionIndex(@PathVariable Long bankId) {
        return service.listQuestionIndex(bankId);
    }

    @GetMapping("/questions/{questionId}")
    public Question question(@PathVariable Long questionId) {
        return service.getQuestion(questionId);
    }

    @GetMapping("/questions/{questionId}/detail")
    public OpenNoteService.QuestionDto questionDetail(@PathVariable Long questionId) {
        return service.getQuestionDetail(questionId);
    }

    @PostMapping("/questions/{questionId}/attempt")
    public Attempt attempt(@PathVariable Long questionId, @RequestBody AttemptRequest request) {
        return service.submitAttempt(questionId, request.answer(), request.status());
    }

    @GetMapping("/progress")
    public InMemoryStore.ProgressSummary progress(@RequestParam Long bankId) {
        return service.progress(bankId);
    }

    @GetMapping("/doodles/{questionId}")
    public DoodleNote doodle(
            @PathVariable Long questionId,
            @RequestParam(defaultValue = "full_canvas") String layer
    ) {
        return service.getDoodle(questionId, layer);
    }

    @PutMapping("/doodles/{questionId}")
    public DoodleNote saveDoodle(
            @PathVariable Long questionId,
            @RequestParam(defaultValue = "full_canvas") String layer,
            @RequestBody DoodleNoteRequest request
    ) {
        DoodleNote note = new DoodleNote(
                request.questionId() == null ? questionId : request.questionId(),
                request.layer() == null ? layer : request.layer(),
                request.layoutVersion(),
                request.baseWidth(),
                request.baseHeight(),
                request.fontScale(),
                request.strokes() == null ? Collections.emptyList() : request.strokes()
        );
        return service.saveDoodle(questionId, layer, note);
    }

    @PostMapping(value = "/imports/question-bank", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public QuestionImportService.ImportResult importQuestionBank(@RequestParam("file") MultipartFile file) {
        return importService.importPackage(file);
    }

    @GetMapping("/import-tasks")
    public List<AiImportTaskService.TaskSummary> importTasks() {
        return aiImportTaskService.listTasks();
    }

    @GetMapping("/import-tasks/{taskId}")
    public AiImportTaskService.TaskSummary importTask(@PathVariable String taskId) {
        return aiImportTaskService.getTask(taskId);
    }

    @PostMapping(value = "/import-tasks", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AiImportTaskService.TaskSummary createImportTask(
            @RequestParam("mode") String mode,
            @RequestParam("materialName") String materialName,
            @RequestParam(value = "splitPage", required = false) Integer splitPage,
            @RequestParam("questionFile") MultipartFile questionFile,
            @RequestParam(value = "answerFile", required = false) MultipartFile answerFile,
            @RequestParam(value = "providerModelName", required = false) String providerModelName,
            @RequestParam(value = "providerBaseUrl", required = false) String providerBaseUrl,
            @RequestParam(value = "providerApiKey", required = false) String providerApiKey
    ) {
        return aiImportTaskService.createTask(
                mode,
                materialName,
                splitPage,
                questionFile,
                answerFile,
                providerModelName,
                providerBaseUrl,
                providerApiKey
        );
    }

    public record AttemptRequest(
            Object answer,
            String status
    ) {
    }

    public record DoodleNoteRequest(
            Long questionId,
            String layer,
            int layoutVersion,
            int baseWidth,
            int baseHeight,
            double fontScale,
            List<DoodleStroke> strokes
    ) {
    }
}
